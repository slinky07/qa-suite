#!/usr/bin/env node

import {
  lstat,
  readdir,
  readFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLedgerTransition,
  assertSafeStrings,
  loadFindingSchema,
  preflightLane,
  validateFindingRows,
  validateProject,
} from "./finding-ledger.mjs";
import {
  assertSchemaValue,
  canonicalJson,
  canonicalJsonDocument,
  parseJsonStrict,
  sha256,
  validateJsonDocument,
  valuesEqual,
} from "./lib/json-contract.mjs";
import {
  assertCreationPath,
  assertIgnoredUntracked,
  assertRegularRepositoryFile,
  assertTrackable,
  candidateCommitsForPaths,
  differsFromHead,
  headCommit,
  isTracked,
  readFileAtCommit,
  readRepositoryFile,
  renameDurable,
  repositoryPath,
  resolveRepository,
  runGit,
  unlinkDurable,
  withExclusiveLocks,
  writeAtomic,
  writeExclusive,
  writeExclusiveIdempotent,
} from "./lib/repository-artifacts.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const referencesPath = resolve(dirname(scriptPath), "../references");
const PROTOCOL = "qa-suite-finding-reconciliation";
const PROTOCOL_VERSION = 1;
const EVIDENCE_FIELD_ORDER = [
  "component",
  "repro_steps",
  "expected_result",
  "actual_result",
  "environment",
  "candidate",
];
const WITHHELD_DECISION = {
  disposition: "blocked",
  reason_code: "sensitive-manual-handling",
  explanation: "Sensitive comparison content is withheld from durable reconciliation.",
  unblock_condition: "An authorized human must review the ignored source proposal.",
  evidence_fields: ["component", "candidate"],
};
const SCHEMA_PATHS = {
  decisions: resolve(
    referencesPath,
    "finding-reconciliation-decisions-v1.schema.json",
  ),
  dispatch: resolve(
    referencesPath,
    "finding-reconciliation-dispatch-v1.schema.json",
  ),
  inventory: resolve(
    referencesPath,
    "finding-reconciliation-inventory-v1.schema.json",
  ),
  receipt: resolve(
    referencesPath,
    "finding-reconciliation-receipt-v1.schema.json",
  ),
  sidecar: resolve(referencesPath, "finding-proposals-v1.schema.json"),
};

let schemasPromise;

async function loadSchemas() {
  schemasPromise ??= Promise.all(
    Object.entries(SCHEMA_PATHS).map(async ([name, path]) => {
      const schema = parseJsonStrict(await readFile(path, "utf8"), path);
      validateJsonDocument(schema, {
        type: "object",
      }, `${name} schema document`);
      return [name, schema];
    }),
  ).then((entries) => Object.fromEntries(entries));
  return schemasPromise;
}

function compareUnicode(left, right) {
  const leftPoints = [...left].map((value) => value.codePointAt(0));
  const rightPoints = [...right].map((value) => value.codePointAt(0));
  const width = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < width; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function sortStrings(values) {
  return [...values].sort(compareUnicode);
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate ${value}`);
    seen.add(value);
  }
}

function parseJsonl(source, label) {
  if (source.length === 0) return [];
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0)) {
    throw new Error(`${label} contains a blank line`);
  }
  return lines.map((line, index) =>
    parseJsonStrict(line, `${label}:${index + 1}`),
  );
}

function expectedArtifactPath(runId, name) {
  return `qa-reconciliation/${runId}/${name}`;
}

function expectedSidecarPath(reportPointer) {
  const dot = reportPointer.lastIndexOf(".");
  const base = dot > reportPointer.lastIndexOf("/")
    ? reportPointer.slice(0, dot)
    : reportPointer;
  return `${base}.proposals.json`;
}

function assertProtocolIdentity(value, label) {
  if (value.schema_version !== PROTOCOL_VERSION || value.protocol !== PROTOCOL) {
    throw new Error(`${label} has unsupported reconciliation protocol identity`);
  }
}

async function readValidatedJson(repositoryRoot, gitPath, schema, label) {
  const artifact = await readRepositoryFile(repositoryRoot, gitPath, label);
  const value = parseJsonStrict(artifact.source, gitPath);
  validateJsonDocument(value, schema, label);
  assertProtocolIdentity(value, label);
  return { ...artifact, digest: sha256(artifact.source), value };
}

function canonicalDispatch(manifest) {
  return {
    ...structuredClone(manifest),
    selected_executions: [...manifest.selected_executions].sort((left, right) =>
      compareUnicode(left.execution_id, right.execution_id),
    ),
  };
}

async function validateDispatchSemantics(
  repositoryRoot,
  manifest,
) {
  const executionIds = manifest.selected_executions.map(({ execution_id }) =>
    execution_id,
  );
  const reportPointers = manifest.selected_executions.map(({ report_pointer }) =>
    report_pointer,
  );
  const sidecarPointers = manifest.selected_executions.map(({ sidecar_pointer }) =>
    sidecar_pointer,
  );
  assertUnique(executionIds, "dispatch execution IDs");
  assertUnique(reportPointers, "dispatch report pointers");
  assertUnique(sidecarPointers, "dispatch sidecar pointers");
  for (const execution of manifest.selected_executions) {
    repositoryPath(repositoryRoot, execution.report_pointer, "dispatch report");
    repositoryPath(repositoryRoot, execution.sidecar_pointer, "dispatch sidecar");
    await assertCreationPath(
      repositoryRoot,
      execution.report_pointer,
      `dispatch ${execution.execution_id} report`,
    );
    await assertCreationPath(
      repositoryRoot,
      execution.sidecar_pointer,
      `dispatch ${execution.execution_id} sidecar`,
    );
    if (execution.sidecar_pointer !== expectedSidecarPath(execution.report_pointer)) {
      throw new Error(
        `dispatch ${execution.execution_id} sidecar must be ${expectedSidecarPath(execution.report_pointer)}`,
      );
    }
    assertIgnoredUntracked(
      repositoryRoot,
      execution.report_pointer,
      `dispatch ${execution.execution_id} report`,
    );
    assertIgnoredUntracked(
      repositoryRoot,
      execution.sidecar_pointer,
      `dispatch ${execution.execution_id} sidecar`,
    );
  }
  if (manifest.candidate.kind === "git-commit") {
    if (!/^[0-9a-f]{40}$/u.test(manifest.candidate.value)) {
      throw new Error("git-commit candidate must be a full lowercase commit SHA");
    }
    const result = runGit(
      repositoryRoot,
      ["cat-file", "-e", `${manifest.candidate.value}^{commit}`],
      [0, 128],
    );
    if (result.status !== 0) {
      throw new Error(`candidate commit is not available: ${manifest.candidate.value}`);
    }
  }
}

export async function freezeDispatchManifest({
  repository = ".",
  manifest,
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  validateJsonDocument(manifest, schemas.dispatch, "dispatch manifest");
  assertProtocolIdentity(manifest, "dispatch manifest");
  const normalized = canonicalDispatch(manifest);
  await validateDispatchSemantics(repositoryRoot, normalized);
  assertSafeStrings(normalized, "dispatch manifest");
  const gitPath = expectedArtifactPath(normalized.run_id, "dispatch-manifest.json");
  const location = await assertCreationPath(repositoryRoot, gitPath, "dispatch manifest");
  assertTrackable(repositoryRoot, gitPath, "dispatch manifest");
  const source = canonicalJsonDocument(normalized);
  const runLock = resolve(dirname(location.absolutePath), ".reconciliation.lock");
  const runLockGitPath = `${dirname(gitPath)}/.reconciliation.lock`;
  assertIgnoredUntracked(repositoryRoot, runLockGitPath, "reconciliation run lock");
  const result = await withExclusiveLocks(
    [runLock],
    {
      pid: process.pid,
      operation: "dispatch",
      run_id: normalized.run_id,
    },
    () => writeExclusiveIdempotent(
      location.absolutePath,
      source,
      `dispatch manifest for run ${normalized.run_id}`,
    ),
  );
  return {
    digest: sha256(source),
    manifest: normalized,
    path: gitPath,
    result,
    source,
  };
}

function proposalSourceDigest(proposal) {
  const source = structuredClone(proposal);
  delete source.source_content_sha256;
  return sha256(canonicalJson(source));
}

function durableProposal(proposal) {
  const comparison = proposal.comparison.storage === "sanitized"
    ? {
        ...structuredClone(proposal.comparison),
        safe_evidence_refs: sortStrings(proposal.comparison.safe_evidence_refs),
      }
    : {
        storage: "withheld",
        reason_code: "sensitive-manual-handling",
        safe_evidence_refs: [],
      };
  const projection = {
    local_id: proposal.local_id,
    source_content_sha256: proposal.source_content_sha256,
    content_sha256: "",
    component: proposal.component,
    severity: proposal.severity,
    priority: proposal.priority,
    sensitivity_classification: proposal.sensitivity_classification,
    comparison,
  };
  const digestInput = structuredClone(projection);
  delete digestInput.content_sha256;
  projection.content_sha256 = sha256(canonicalJson(digestInput));
  assertSafeStrings(projection, `durable proposal ${proposal.local_id}`);
  return projection;
}

function normalizeUnexecuted(unexecuted, manifest, inventorySchema) {
  const value = structuredClone(unexecuted ?? []);
  assertSchemaValue(
    value,
    inventorySchema.properties.unexecuted,
    inventorySchema,
    "unexecuted records",
  );
  const byExecution = new Map(
    manifest.selected_executions.map((execution) => [execution.execution_id, execution]),
  );
  assertUnique(value.map(({ execution_id }) => execution_id), "unexecuted execution IDs");
  for (const record of value) {
    const selected = byExecution.get(record.execution_id);
    if (!selected) {
      throw new Error(`unexecuted record references unknown execution ${record.execution_id}`);
    }
    if (record.lane !== selected.lane) {
      throw new Error(`unexecuted ${record.execution_id} lane does not match dispatch`);
    }
    assertSafeStrings(record, `unexecuted ${record.execution_id}`);
  }
  return value.sort((left, right) => compareUnicode(left.execution_id, right.execution_id));
}

async function inventoryReport(repositoryRoot, execution, manifest, schemas) {
  const report = await readRepositoryFile(
    repositoryRoot,
    execution.report_pointer,
    `report ${execution.execution_id}`,
  );
  const sidecar = await readValidatedJson(
    repositoryRoot,
    execution.sidecar_pointer,
    schemas.sidecar,
    `sidecar ${execution.execution_id}`,
  );
  assertIgnoredUntracked(repositoryRoot, execution.report_pointer, "lane report");
  assertIgnoredUntracked(repositoryRoot, execution.sidecar_pointer, "lane sidecar");
  const reportDigest = sha256(report.source);
  const value = sidecar.value;
  for (const [field, expected] of [
    ["run_id", manifest.run_id],
    ["execution_id", execution.execution_id],
    ["lane", execution.lane],
  ]) {
    if (value[field] !== expected) {
      throw new Error(`sidecar ${execution.execution_id} ${field} does not match dispatch`);
    }
  }
  if (!valuesEqual(value.candidate, manifest.candidate)) {
    throw new Error(`sidecar ${execution.execution_id} candidate does not match dispatch`);
  }
  if (
    value.report.path !== execution.report_pointer ||
    value.report.sha256 !== reportDigest
  ) {
    throw new Error(`sidecar ${execution.execution_id} report identity drifted`);
  }
  assertUnique(
    value.proposals.map(({ local_id }) => local_id),
    `sidecar ${execution.execution_id} proposal IDs`,
  );
  const proposals = [...value.proposals]
    .sort((left, right) => compareUnicode(left.local_id, right.local_id))
    .map((proposal) => {
      if (
        proposal.sensitivity_classification !== "standard" &&
        proposal.comparison.storage !== "sensitive-local"
      ) {
        throw new Error(
          `proposal ${execution.execution_id}/${proposal.local_id} has sensitive classification ` +
          "but does not use sensitive-local comparison storage",
        );
      }
      const observed = proposalSourceDigest(proposal);
      if (observed !== proposal.source_content_sha256) {
        throw new Error(
          `proposal ${execution.execution_id}/${proposal.local_id} source digest mismatch`,
        );
      }
      return durableProposal(proposal);
    });
  return {
    execution_id: execution.execution_id,
    lane: execution.lane,
    report: { path: execution.report_pointer, sha256: reportDigest },
    sidecar: { path: execution.sidecar_pointer, sha256: sidecar.digest },
    proposals,
  };
}

async function assertUnexecutedSourcesAbsent(repositoryRoot, execution) {
  for (const [gitPath, label] of [
    [execution.report_pointer, "report"],
    [execution.sidecar_pointer, "sidecar"],
  ]) {
    const location = await assertCreationPath(
      repositoryRoot,
      gitPath,
      `unexecuted ${execution.execution_id} ${label}`,
    );
    if (await pathSource(location.absolutePath) !== undefined) {
      throw new Error(
        `execution ${execution.execution_id} cannot be unexecuted because its completed ${label} exists`,
      );
    }
  }
}

async function loadCanonicalDispatch(
  repositoryRoot,
  dispatchPath,
  schema,
) {
  const dispatch = await readValidatedJson(
    repositoryRoot,
    dispatchPath,
    schema,
    "dispatch manifest",
  );
  const normalized = canonicalDispatch(dispatch.value);
  await validateDispatchSemantics(repositoryRoot, normalized);
  if (dispatch.source !== canonicalJsonDocument(normalized)) {
    throw new Error("dispatch manifest bytes are not canonical or were modified after freeze");
  }
  const expectedPath = expectedArtifactPath(normalized.run_id, "dispatch-manifest.json");
  if (dispatch.gitPath !== expectedPath) {
    throw new Error(`dispatch manifest must be stored at ${expectedPath}`);
  }
  return { ...dispatch, value: normalized };
}

async function preflightPriorReconciliationRuns(
  repositoryRoot,
  currentRunId,
) {
  const root = resolve(repositoryRoot, "qa-reconciliation");
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.name === currentRunId) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`reconciliation run path is unsafe: qa-reconciliation/${entry.name}`);
    }
    const names = await readdir(resolve(root, entry.name));
    const residue = names.filter((name) =>
      name.startsWith(".transaction-") ||
      name.endsWith(".stage") ||
      name.endsWith(".exclusive-stage") ||
      name.endsWith(".stale-recovery") ||
      name.includes(".owner-"),
    );
    if (residue.length > 0) {
      throw new Error(
        `prior run ${entry.name} requires transaction recovery before a later inventory`,
      );
    }
    const receiptName = "reconciliation-receipt.json";
    const hasProtocolArtifacts = names.some((name) => [
      "dispatch-manifest.json",
      "proposal-inventory.json",
      receiptName,
    ].includes(name));
    if (!hasProtocolArtifacts) continue;
    if (!names.includes(receiptName)) {
      throw new Error(`prior run ${entry.name} is incomplete and requires recovery`);
    }
    const schemas = await loadSchemas();
    const receipt = await readValidatedJson(
      repositoryRoot,
      `qa-reconciliation/${entry.name}/${receiptName}`,
      schemas.receipt,
      `prior run ${entry.name} receipt`,
    );
    if (!await durableReceiptCommit(repositoryRoot, receipt, schemas)) {
      throw new Error(`prior run ${entry.name} must be committed before a later inventory`);
    }
  }
}

export async function createProposalInventory({
  repository = ".",
  context = "qa-context.md",
  dispatchPath,
  createdAt,
  unexecuted = [],
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    dispatchPath,
    schemas.dispatch,
  );
  const normalizedUnexecuted = normalizeUnexecuted(
    unexecuted,
    dispatch.value,
    schemas.inventory,
  );
  const unexecutedIds = new Set(
    normalizedUnexecuted.map(({ execution_id }) => execution_id),
  );
  const inventoryPath = expectedArtifactPath(
    dispatch.value.run_id,
    "proposal-inventory.json",
  );
  const inventoryLocation = await assertCreationPath(
    repositoryRoot,
    inventoryPath,
    "proposal inventory",
  );
  assertTrackable(repositoryRoot, inventoryPath, "proposal inventory");
  const runLock = resolve(dirname(inventoryLocation.absolutePath), ".reconciliation.lock");
  const runLockGitPath = `${dirname(inventoryPath)}/.reconciliation.lock`;
  assertIgnoredUntracked(repositoryRoot, runLockGitPath, "reconciliation run lock");
  const initialProject = await validateProject({ repository: repositoryRoot, context });
  return withExclusiveLocks(
    [runLock, `${initialProject.ledgerPath}.lock`],
    {
      pid: process.pid,
      operation: "inventory",
      run_id: dispatch.value.run_id,
      dispatch_sha256: dispatch.digest,
    },
    async () => {
      const currentDispatch = await loadCanonicalDispatch(
        repositoryRoot,
        dispatchPath,
        schemas.dispatch,
      );
      if (currentDispatch.digest !== dispatch.digest) {
        throw new Error("dispatch manifest changed while inventory waited for its lock");
      }
      const project = await validateProject({ repository: repositoryRoot, context });
      if (
        project.ledgerGitPath !== initialProject.ledgerGitPath ||
        project.schemaVersion !== initialProject.schemaVersion
      ) {
        throw new Error("finding ledger location or schema changed while inventory waited for locks");
      }
      if (!isTracked(repositoryRoot, project.ledgerGitPath) ||
          differsFromHead(repositoryRoot, project.ledgerGitPath)) {
        throw new Error("proposal inventory requires the previous finding ledger to be committed in HEAD");
      }
      await preflightPriorReconciliationRuns(
        repositoryRoot,
        dispatch.value.run_id,
      );
      const reports = [];
      for (const execution of dispatch.value.selected_executions) {
        if (unexecutedIds.has(execution.execution_id)) {
          await assertUnexecutedSourcesAbsent(repositoryRoot, execution);
        } else {
          reports.push(
            await inventoryReport(repositoryRoot, execution, dispatch.value, schemas),
          );
        }
      }
      const represented = new Set([
        ...reports.map(({ execution_id }) => execution_id),
        ...normalizedUnexecuted.map(({ execution_id }) => execution_id),
      ]);
      if (represented.size !== dispatch.value.selected_executions.length) {
        throw new Error("inventory does not account for every selected execution exactly once");
      }
      const inventory = {
        schema_version: PROTOCOL_VERSION,
        protocol: PROTOCOL,
        run_id: dispatch.value.run_id,
        candidate: structuredClone(dispatch.value.candidate),
        created_at: createdAt,
        dispatch_manifest: { path: dispatch.gitPath, sha256: dispatch.digest },
        previous_ledger: {
          path: project.ledgerGitPath,
          schema_version: project.schemaVersion,
          sha256: project.digest,
          row_count: project.rows.length,
        },
        reports,
        unexecuted: normalizedUnexecuted,
      };
      validateInventorySemantics(repositoryRoot, inventory, currentDispatch.value, project);
      validateJsonDocument(inventory, schemas.inventory, "proposal inventory");
      assertSafeStrings(inventory, "proposal inventory");
      const source = canonicalJsonDocument(inventory);
      const result = await writeExclusiveIdempotent(
        inventoryLocation.absolutePath,
        source,
        `proposal inventory for run ${inventory.run_id}`,
      );
      return {
        digest: sha256(source),
        inventory,
        path: inventoryPath,
        result,
        source,
      };
    },
  );
}

function proposalReference(report, proposal) {
  return {
    execution_id: report.execution_id,
    lane: report.lane,
    report_pointer: report.report.path,
    report_sha256: report.report.sha256,
    local_id: proposal.local_id,
    source_content_sha256: proposal.source_content_sha256,
    content_sha256: proposal.content_sha256,
  };
}

function proposalKey(reference) {
  return canonicalJson(reference);
}

function inventoryProposals(inventory) {
  const proposals = [];
  for (const report of inventory.reports) {
    for (const proposal of report.proposals) {
      const reference = proposalReference(report, proposal);
      proposals.push({ key: proposalKey(reference), proposal, reference, report });
    }
  }
  proposals.sort((left, right) => compareUnicode(left.key, right.key));
  assertUnique(proposals.map(({ key }) => key), "inventory proposal identities");
  return proposals;
}

function semanticCandidate(row) {
  return {
    id: row.id,
    lane: row.lane,
    severity: row.severity,
    priority: row.priority,
    component: row.component,
    location: row.location,
    oracle: row.oracle,
    status: row.status,
    candidate_first_seen: row.candidate_first_seen,
    candidate_last_confirmed: row.candidate_last_confirmed,
    defect_record: structuredClone(row.defect_record),
    reports: structuredClone(row.reports),
    sensitivity: structuredClone(row.sensitivity),
  };
}

async function sourceProposalsByKey(repositoryRoot, inventory, schemas) {
  const proposals = new Map();
  for (const report of inventory.reports) {
    const sidecar = await readValidatedJson(
      repositoryRoot,
      report.sidecar.path,
      schemas.sidecar,
      `sidecar ${report.execution_id}`,
    );
    if (sidecar.digest !== report.sidecar.sha256) {
      throw new Error(`sidecar ${report.execution_id} digest drifted after inventory`);
    }
    for (const proposal of sidecar.value.proposals) {
      proposals.set(
        `${report.execution_id}\u0000${proposal.local_id}`,
        proposal,
      );
    }
  }
  return proposals;
}

export async function buildSemanticDecisionTask({
  repository = ".",
  context = "qa-context.md",
  inventoryPath,
  component,
}) {
  if (typeof component !== "string" || component.length === 0) {
    throw new Error("semantic review requires one exact component");
  }
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const inventory = await loadInventory(repositoryRoot, inventoryPath, schemas);
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    inventory.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (dispatch.digest !== inventory.value.dispatch_manifest.sha256) {
    throw new Error("inventory dispatch digest does not match current frozen bytes");
  }
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  await verifyInventorySources(repositoryRoot, inventory.value, dispatch.value, schemas);
  const project = await validateProject({ repository: repositoryRoot, context });
  if (
    project.ledgerGitPath !== inventory.value.previous_ledger.path ||
    project.schemaVersion !== inventory.value.previous_ledger.schema_version ||
    project.digest !== inventory.value.previous_ledger.sha256 ||
    project.rows.length !== inventory.value.previous_ledger.row_count
  ) {
    throw new Error("finding ledger drifted from the frozen proposal inventory");
  }

  const entries = inventoryProposals(inventory.value)
    .filter(({ proposal }) => proposal.component === component)
    .sort((left, right) => compareUnicode(left.key, right.key));
  if (entries.length === 0) {
    throw new Error(`proposal inventory has no semantic review group for component ${component}`);
  }
  const sourceProposals = await sourceProposalsByKey(
    repositoryRoot,
    inventory.value,
    schemas,
  );
  const proposals = entries.map((entry) => {
    const source = sourceProposals.get(
      `${entry.report.execution_id}\u0000${entry.proposal.local_id}`,
    );
    if (!source) {
      throw new Error(`source proposal is missing for semantic review ${entry.key}`);
    }
    const identity = entry.proposal.comparison.storage === "withheld"
      ? {
          storage: "withheld",
          location: null,
          oracle: null,
        }
      : {
          storage: "sanitized",
          location: source.location,
          oracle: source.oracle,
        };
    assertSafeStrings(identity, `semantic review identity ${entry.key}`);
    return {
      proposal: structuredClone(entry.reference),
      identity,
      severity: entry.proposal.severity,
      priority: entry.proposal.priority,
      sensitivity_classification: entry.proposal.sensitivity_classification,
      comparison: structuredClone(entry.proposal.comparison),
      required_decision: entry.proposal.comparison.storage === "withheld"
        ? structuredClone(WITHHELD_DECISION)
        : null,
    };
  });
  const candidateFindings = project.rows
    .filter((row) => row.component === component)
    .sort((left, right) => compareUnicode(left.id, right.id))
    .map(semanticCandidate);
  const task = {
    schema_version: 1,
    protocol: PROTOCOL,
    kind: "semantic-decision-task",
    run_id: inventory.value.run_id,
    candidate: structuredClone(inventory.value.candidate),
    inventory: { path: inventory.gitPath, sha256: inventory.digest },
    component,
    candidate_finding_ids: candidateFindings.map(({ id }) => id),
    proposals,
    candidate_findings: candidateFindings,
  };
  assertSafeStrings(task, `semantic decision task for ${component}`);
  return task;
}

function strongerValue(current, proposed, order) {
  return order.indexOf(proposed) < order.indexOf(current) ? proposed : current;
}

function proposalEntryForDecision(entries, decision) {
  const entry = entries.get(proposalKey(decision.proposal));
  if (!entry) {
    throw new Error(
      `decision references unknown proposal ${proposalKey(decision.proposal)}`,
    );
  }
  return entry;
}

function reportProvenance(inventory, entry) {
  return {
    candidate: inventory.candidate.value,
    lane: entry.reference.lane,
    pointer: entry.reference.report_pointer,
  };
}

function createdFindingRow(project, inventory, decision, entry, sourceProposal) {
  if (
    entry.proposal.sensitivity_classification !== "standard" ||
    sourceProposal.sensitivity_classification !== "standard" ||
    entry.proposal.comparison.storage !== "sanitized" ||
    sourceProposal.comparison.storage !== "sanitized"
  ) {
    throw new Error(
      `created decision cannot materialize sensitive or withheld proposal ${proposalKey(decision.proposal)}`,
    );
  }
  return {
    id: decision.stable_finding_id,
    schema_version: project.schemaVersion,
    lane: entry.reference.lane,
    severity: entry.proposal.severity,
    priority: entry.proposal.priority,
    component: entry.proposal.component,
    location: sourceProposal.location,
    oracle: sourceProposal.oracle,
    status: "open",
    status_reason: null,
    candidate_first_seen: inventory.candidate.value,
    candidate_last_confirmed: inventory.candidate.value,
    first_seen: decision.reconciled_at,
    last_seen: decision.reconciled_at,
    occurrences: 1,
    defect_record: {
      actual_result: sourceProposal.comparison.actual_result,
      environment: sourceProposal.comparison.environment,
      expected_result: sourceProposal.comparison.expected_result,
      repro_steps: structuredClone(sourceProposal.comparison.repro_steps),
    },
    reports: [reportProvenance(inventory, entry)],
    sensitivity: {
      classification: "standard",
      clearance: null,
      storage: "committed",
    },
  };
}

function addReportProvenance(row, report) {
  if (!row.reports.some(({ pointer }) => pointer === report.pointer)) {
    row.reports.push(report);
  }
}

function evolveMatchedFinding(row, current, inventory, reconciledAt, entries) {
  for (const entry of entries) {
    row.severity = strongerValue(
      row.severity,
      entry.proposal.severity,
      ["S1", "S2", "S3", "S4"],
    );
    row.priority = strongerValue(
      row.priority,
      entry.proposal.priority,
      ["P0", "P1", "P2", "P3"],
    );
    addReportProvenance(row, reportProvenance(inventory, entry));
  }
  if (!current) return;
  if (inventory.candidate.value !== current.candidate_last_confirmed) {
    row.candidate_last_confirmed = inventory.candidate.value;
    row.occurrences = current.occurrences + 1;
    row.last_seen = reconciledAt;
    if (current.status === "fixed") {
      row.status = "regressed";
      row.status_reason = null;
    }
  } else if (Date.parse(reconciledAt) > Date.parse(current.last_seen)) {
    row.last_seen = reconciledAt;
  }
}

function validateDecisionIdentity(decision, inventory) {
  if (decision.value.run_id !== inventory.value.run_id) {
    throw new Error("decision envelope run_id does not match inventory");
  }
  if (!valuesEqual(decision.value.candidate, inventory.value.candidate)) {
    throw new Error("decision envelope candidate does not match inventory");
  }
  if (
    decision.value.inventory.path !== inventory.gitPath ||
    decision.value.inventory.sha256 !== inventory.digest
  ) {
    throw new Error("decision envelope inventory identity does not match frozen bytes");
  }
}

export async function materializeCandidateLedger({
  repository = ".",
  context = "qa-context.md",
  inventoryPath,
  decisionPath,
  candidateLedgerPath,
  outputDecisionPath,
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const inventory = await loadInventory(repositoryRoot, inventoryPath, schemas);
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    inventory.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (dispatch.digest !== inventory.value.dispatch_manifest.sha256) {
    throw new Error("inventory dispatch digest does not match current frozen bytes");
  }
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  await verifyInventorySources(repositoryRoot, inventory.value, dispatch.value, schemas);
  const project = await validateProject({ repository: repositoryRoot, context });
  if (
    project.ledgerGitPath !== inventory.value.previous_ledger.path ||
    project.schemaVersion !== inventory.value.previous_ledger.schema_version ||
    project.digest !== inventory.value.previous_ledger.sha256 ||
    project.rows.length !== inventory.value.previous_ledger.row_count
  ) {
    throw new Error("finding ledger drifted from the frozen proposal inventory");
  }
  const decision = await loadDecisionEnvelope(
    repositoryRoot,
    decisionPath,
    schemas.decisions,
  );
  validateDecisionIdentity(decision, inventory);
  if (decision.value.candidate_ledger !== null) {
    throw new Error("materialization input must not provide a candidate ledger");
  }
  const decisions = normalizeDecisions(decision.value);
  const hasLedgerChanges = decisions.some(({ disposition }) =>
    ["created", "matched"].includes(disposition),
  );
  if (
    hasLedgerChanges &&
    decisions.some(({ disposition }) => disposition === "blocked")
  ) {
    throw new Error("blocked decisions cannot coexist with created or matched dispositions");
  }

  const inventoryEntries = new Map(
    inventoryProposals(inventory.value).map((entry) => [entry.key, entry]),
  );
  const sourceProposals = await sourceProposalsByKey(
    repositoryRoot,
    inventory.value,
    schemas,
  );
  const currentById = new Map(project.rows.map((row) => [row.id, row]));
  const candidateById = new Map(
    project.rows.map((row) => [row.id, structuredClone(row)]),
  );
  const createdIds = new Set();
  for (const semantic of decisions.filter(({ disposition }) => disposition === "created")) {
    if (createdIds.has(semantic.stable_finding_id) || currentById.has(semantic.stable_finding_id)) {
      throw new Error(
        `created stable finding ${semantic.stable_finding_id} is not a unique new identity`,
      );
    }
    const entry = proposalEntryForDecision(inventoryEntries, semantic);
    const source = sourceProposals.get(
      `${entry.report.execution_id}\u0000${entry.proposal.local_id}`,
    );
    if (!source) {
      throw new Error(`source proposal is missing for ${entry.key}`);
    }
    const row = createdFindingRow(
      project,
      inventory.value,
      { ...semantic, reconciled_at: decision.value.reconciled_at },
      entry,
      source,
    );
    candidateById.set(row.id, row);
    createdIds.add(row.id);
  }

  const matchesById = new Map();
  for (const semantic of decisions.filter(({ disposition }) => disposition === "matched")) {
    const entries = matchesById.get(semantic.stable_finding_id) ?? [];
    entries.push(proposalEntryForDecision(inventoryEntries, semantic));
    matchesById.set(semantic.stable_finding_id, entries);
  }
  for (const [stableId, entries] of matchesById) {
    const row = candidateById.get(stableId);
    if (!row) {
      throw new Error(`matched stable finding ${stableId} is absent`);
    }
    evolveMatchedFinding(
      row,
      currentById.get(stableId),
      inventory.value,
      decision.value.reconciled_at,
      entries,
    );
  }

  let candidate = null;
  let candidateSource = null;
  let candidateDigest = null;
  let candidateLocation = null;
  if (hasLedgerChanges) {
    const ledgerSource = await readFile(project.ledgerPath, "utf8");
    const currentLines = ledgerSource.length === 0
      ? []
      : ledgerSource.trimEnd().split("\n");
    const outputLines = project.rows.map((row, index) => {
      const evolved = candidateById.get(row.id);
      return valuesEqual(row, evolved) ? currentLines[index] : JSON.stringify(evolved);
    });
    for (const id of sortStrings(createdIds)) {
      outputLines.push(JSON.stringify(candidateById.get(id)));
    }
    candidateSource = `${outputLines.join("\n")}\n`;
    const candidateRows = parseJsonl(candidateSource, "materialized candidate ledger");
    validateFindingRows(candidateRows, project.schema, project);
    assertLedgerTransition(project.rows, candidateRows);
    candidateDigest = sha256(candidateSource);
    candidateLocation = await assertCreationPath(
      repositoryRoot,
      candidateLedgerPath,
      "materialized candidate ledger",
    );
    assertIgnoredUntracked(
      repositoryRoot,
      candidateLocation.gitPath,
      "materialized candidate ledger",
    );
    if (candidateLocation.gitPath === project.ledgerGitPath) {
      throw new Error("materialized candidate ledger cannot be the canonical ledger");
    }
    candidate = {
      digest: candidateDigest,
      rows: candidateRows,
      source: candidateSource,
    };
  }

  const finalized = {
    ...structuredClone(decision.value),
    candidate_ledger: candidateLocation
      ? { path: candidateLocation.gitPath, sha256: candidateDigest }
      : null,
    decisions,
  };
  validateJsonDocument(finalized, schemas.decisions, "materialized decision envelope");
  assertSafeStrings(finalized, "materialized decision envelope");
  verifyDecisionAccounting(
    inventory.value,
    finalized,
    project.rows,
    candidate,
  );
  const outputLocation = await assertCreationPath(
    repositoryRoot,
    outputDecisionPath,
    "materialized decision envelope",
  );
  assertIgnoredUntracked(
    repositoryRoot,
    outputLocation.gitPath,
    "materialized decision envelope",
  );
  if (outputLocation.gitPath === decision.gitPath) {
    throw new Error("materialized decision envelope must use a new path");
  }
  if (candidateLocation) {
    await writeExclusiveIdempotent(
      candidateLocation.absolutePath,
      candidateSource,
      "materialized candidate ledger",
    );
  }
  const finalizedSource = canonicalJsonDocument(finalized);
  await writeExclusiveIdempotent(
    outputLocation.absolutePath,
    finalizedSource,
    "materialized decision envelope",
  );
  return {
    candidateLedgerPath: candidateLocation?.gitPath ?? null,
    candidateLedgerDigest: candidateDigest,
    decisionPath: outputLocation.gitPath,
    decisionDigest: sha256(finalizedSource),
    decision: finalized,
  };
}

function validateInventorySemantics(repositoryRoot, inventory, dispatch, project) {
  if (inventory.run_id !== dispatch.run_id || !valuesEqual(inventory.candidate, dispatch.candidate)) {
    throw new Error("proposal inventory run or candidate does not match dispatch");
  }
  const selectedById = new Map(
    dispatch.selected_executions.map((execution) => [execution.execution_id, execution]),
  );
  const reportIds = inventory.reports.map(({ execution_id }) => execution_id);
  const unexecutedIds = inventory.unexecuted.map(({ execution_id }) => execution_id);
  assertUnique(reportIds, "inventory report execution IDs");
  assertUnique(unexecutedIds, "inventory unexecuted execution IDs");
  if (!valuesEqual(reportIds, sortStrings(reportIds))) {
    throw new Error("inventory reports must be in canonical execution-ID order");
  }
  if (!valuesEqual(unexecutedIds, sortStrings(unexecutedIds))) {
    throw new Error("inventory unexecuted records must be in canonical execution-ID order");
  }
  const represented = [...reportIds, ...unexecutedIds];
  assertUnique(represented, "inventory represented execution IDs");
  if (!valuesEqual(sortStrings(represented), sortStrings(selectedById.keys()))) {
    throw new Error("inventory must equal the exact dispatch report and unexecuted union");
  }
  for (const report of inventory.reports) {
    const selected = selectedById.get(report.execution_id);
    if (
      report.lane !== selected.lane ||
      report.report.path !== selected.report_pointer ||
      report.sidecar.path !== selected.sidecar_pointer
    ) {
      throw new Error(`inventory report ${report.execution_id} identity does not match dispatch`);
    }
    const localIds = report.proposals.map(({ local_id }) => local_id);
    assertUnique(localIds, `inventory ${report.execution_id} proposal IDs`);
    if (!valuesEqual(localIds, sortStrings(localIds))) {
      throw new Error(`inventory ${report.execution_id} proposals are not canonically ordered`);
    }
    for (const proposal of report.proposals) {
      const digestInput = structuredClone(proposal);
      delete digestInput.content_sha256;
      if (sha256(canonicalJson(digestInput)) !== proposal.content_sha256) {
        throw new Error(`inventory proposal ${report.execution_id}/${proposal.local_id} digest mismatch`);
      }
    }
  }
  for (const record of inventory.unexecuted) {
    const selected = selectedById.get(record.execution_id);
    if (record.lane !== selected.lane) {
      throw new Error(`inventory unexecuted ${record.execution_id} lane does not match dispatch`);
    }
  }
  if (project && (
    inventory.previous_ledger.path !== project.ledgerGitPath ||
    inventory.previous_ledger.schema_version !== project.schemaVersion ||
    inventory.previous_ledger.sha256 !== project.digest ||
    inventory.previous_ledger.row_count !== project.rows.length
  )) {
    throw new Error("inventory previous-ledger identity does not match the frozen ledger");
  }
  assertSafeStrings(inventory, "proposal inventory");
}

function canonicalDecision(decision) {
  const normalized = structuredClone(decision);
  normalized.candidate_finding_ids = sortStrings(normalized.candidate_finding_ids);
  normalized.evidence_fields = [...normalized.evidence_fields].sort(
    (left, right) =>
      EVIDENCE_FIELD_ORDER.indexOf(left) - EVIDENCE_FIELD_ORDER.indexOf(right),
  );
  return normalized;
}

function normalizeDecisions(envelope) {
  return [...envelope.decisions]
    .map(canonicalDecision)
    .sort((left, right) =>
      compareUnicode(proposalKey(left.proposal), proposalKey(right.proposal)),
    );
}

async function verifyInventorySources(repositoryRoot, inventory, dispatch, schemas) {
  const selectedById = new Map(
    dispatch.selected_executions.map((execution) => [execution.execution_id, execution]),
  );
  for (const frozenReport of inventory.reports) {
    const execution = selectedById.get(frozenReport.execution_id);
    if (!execution) {
      throw new Error(`inventory report ${frozenReport.execution_id} is absent from dispatch`);
    }
    const observed = await inventoryReport(
      repositoryRoot,
      execution,
      dispatch,
      schemas,
    );
    if (!valuesEqual(observed, frozenReport)) {
      throw new Error(`report or proposal drift detected for ${frozenReport.execution_id}`);
    }
  }
}

async function loadInventory(repositoryRoot, inventoryPath, schemas) {
  const inventory = await readValidatedJson(
    repositoryRoot,
    inventoryPath,
    schemas.inventory,
    "proposal inventory",
  );
  const expectedPath = expectedArtifactPath(inventory.value.run_id, "proposal-inventory.json");
  if (inventory.gitPath !== expectedPath) {
    throw new Error(`proposal inventory must be stored at ${expectedPath}`);
  }
  if (inventory.source !== canonicalJsonDocument(inventory.value)) {
    throw new Error("proposal inventory bytes are not canonical or were modified after freeze");
  }
  return inventory;
}

async function loadDecisionEnvelope(repositoryRoot, decisionPath, schema) {
  const artifact = await readRepositoryFile(
    repositoryRoot,
    decisionPath,
    "decision envelope",
  );
  assertIgnoredUntracked(repositoryRoot, artifact.gitPath, "decision envelope");
  const value = parseJsonStrict(artifact.source, artifact.gitPath);
  validateJsonDocument(value, schema, "decision envelope");
  assertProtocolIdentity(value, "decision envelope");
  assertSafeStrings(value, "decision envelope");
  return { ...artifact, digest: sha256(artifact.source), value };
}

async function loadCandidateLedger(
  repositoryRoot,
  context,
  envelope,
  project,
) {
  if (envelope.candidate_ledger === null) return null;
  const artifact = await readRepositoryFile(
    repositoryRoot,
    envelope.candidate_ledger.path,
    "candidate ledger",
  );
  assertIgnoredUntracked(repositoryRoot, artifact.gitPath, "candidate ledger");
  if (artifact.gitPath === project.ledgerGitPath) {
    throw new Error("candidate ledger must not overwrite the canonical ledger before verification");
  }
  const digest = sha256(artifact.source);
  if (digest !== envelope.candidate_ledger.sha256) {
    throw new Error("candidate ledger digest does not match the decision envelope");
  }
  const rows = parseJsonl(artifact.source, artifact.gitPath);
  validateFindingRows(rows, project.schema, project);
  assertLedgerTransition(project.rows, rows);
  const temporaryLanes = new Set(
    rows
      .map(({ lane }) => lane)
      .filter((lane) => lane.startsWith("temporary-qa-")),
  );
  for (const lane of temporaryLanes) {
    await preflightLane({ repository: repositoryRoot, context, lane });
  }
  return { ...artifact, digest, rows };
}

function assertArrayIdentity(observed, expected, label) {
  if (!valuesEqual(observed, expected)) {
    throw new Error(`${label} does not match the deterministic candidate set`);
  }
}

function verifyDecisionAccounting(inventory, envelope, currentRows, candidate) {
  const proposals = inventoryProposals(inventory);
  const proposalsByKey = new Map(proposals.map((entry) => [entry.key, entry]));
  const decisions = normalizeDecisions(envelope);
  if (
    decisions.some(({ disposition }) => disposition === "blocked") &&
    decisions.some(({ disposition }) => ["created", "matched"].includes(disposition))
  ) {
    throw new Error("blocked decisions cannot coexist with created or matched dispositions");
  }
  const decisionKeys = decisions.map(({ proposal }) => proposalKey(proposal));
  assertUnique(decisionKeys, "decision proposal identities");
  const decisionKeySet = new Set(decisionKeys);
  for (const key of decisionKeys) {
    if (!proposalsByKey.has(key)) {
      throw new Error(`decision references unknown proposal ${key}`);
    }
  }
  const missing = proposals.filter(({ key }) => !decisionKeySet.has(key));
  if (missing.length > 0) {
    throw new Error(`missing decisions for ${missing.length} inventoried proposal(s)`);
  }
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const candidateById = new Map((candidate?.rows ?? currentRows).map((row) => [row.id, row]));
  const createdById = new Map();
  for (const decision of decisions.filter(({ disposition }) => disposition === "created")) {
    const list = createdById.get(decision.stable_finding_id) ?? [];
    list.push(decision);
    createdById.set(decision.stable_finding_id, list);
  }
  for (const [stableId, created] of createdById) {
    if (created.length !== 1) {
      throw new Error(`stable finding ${stableId} must have exactly one created decision`);
    }
    if (currentById.has(stableId) || !candidateById.has(stableId)) {
      throw new Error(`created stable finding ${stableId} is not a new candidate-ledger row`);
    }
  }
  for (const row of candidateById.values()) {
    if (!currentById.has(row.id) && !createdById.has(row.id)) {
      throw new Error(`new candidate-ledger row ${row.id} has no created decision`);
    }
  }
  const createdComponents = new Map(
    [...createdById.keys()].map((id) => [id, candidateById.get(id)?.component]),
  );
  const candidatesByComponent = new Map();
  for (const row of currentRows) {
    const ids = candidatesByComponent.get(row.component) ?? [];
    ids.push(row.id);
    candidatesByComponent.set(row.component, ids);
  }
  for (const [id, component] of createdComponents) {
    const ids = candidatesByComponent.get(component) ?? [];
    ids.push(id);
    candidatesByComponent.set(component, ids);
  }
  for (const ids of candidatesByComponent.values()) ids.sort(compareUnicode);
  const matchedIds = new Set();
  const representedByReport = new Map();
  for (const decision of decisions) {
    if (decision.disposition === "matched") matchedIds.add(decision.stable_finding_id);
    if (["created", "matched"].includes(decision.disposition)) {
      const entry = proposalsByKey.get(proposalKey(decision.proposal));
      const ids = representedByReport.get(entry.report.report.path) ?? new Set();
      ids.add(decision.stable_finding_id);
      representedByReport.set(entry.report.report.path, ids);
    }
  }
  for (const decision of decisions) {
    const entry = proposalsByKey.get(proposalKey(decision.proposal));
    const component = entry.proposal.component;
    let expectedCandidates = candidatesByComponent.get(component) ?? [];
    if (decision.disposition === "created") {
      expectedCandidates = expectedCandidates.filter(
        (id) => id !== decision.stable_finding_id,
      );
    }
    assertArrayIdentity(
      decision.candidate_finding_ids,
      expectedCandidates,
      `decision ${proposalKey(decision.proposal)} candidate_finding_ids`,
    );
    if (entry.proposal.comparison.storage === "withheld") {
      for (const [field, expected] of Object.entries(WITHHELD_DECISION)) {
        if (!valuesEqual(decision[field], expected)) {
          throw new Error(
            `withheld proposal decision ${field} must use the fixed sensitive-manual-handling contract`,
          );
        }
      }
    }
    if (["created", "matched"].includes(decision.disposition)) {
      const stableRow = candidateById.get(decision.stable_finding_id);
      if (!stableRow) {
        throw new Error(
          `${decision.disposition} decision references absent stable finding ${decision.stable_finding_id}`,
        );
      }
      if (stableRow.component !== component) {
        throw new Error(
          `${decision.disposition} decision crosses component identity for ${decision.stable_finding_id}`,
        );
      }
      if (
        decision.disposition === "matched" &&
        !decision.candidate_finding_ids.includes(decision.stable_finding_id)
      ) {
        throw new Error(`matched decision did not name its stable finding as a candidate`);
      }
      const hasProvenance = stableRow.reports.some(
        (report) =>
          report.pointer === entry.reference.report_pointer &&
          report.lane === entry.reference.lane &&
          report.candidate === inventory.candidate.value,
      );
      if (!hasProvenance) {
        throw new Error(
          `stable finding ${stableRow.id} lacks proposal report provenance ${entry.reference.report_pointer}`,
        );
      }
    }
  }
  for (const row of currentRows) {
    const candidateRow = candidateById.get(row.id);
    const hasMatch = matchedIds.has(row.id);
    if (!hasMatch && candidateRow && !valuesEqual(row, candidateRow)) {
      throw new Error(`unmatched stable finding ${row.id} changed in candidate ledger`);
    }
  }
  for (const decision of decisions.filter(
    ({ reason_code }) => reason_code === "duplicate-of-named-stable-finding",
  )) {
    const entry = proposalsByKey.get(proposalKey(decision.proposal));
    const representedIds = representedByReport.get(entry.report.report.path) ?? new Set();
    const represented = decision.candidate_finding_ids.some((id) => representedIds.has(id));
    if (!represented) {
      throw new Error(
        "duplicate rejection must name a stable finding represented by another proposal from the same report",
      );
    }
  }
  return { decisions, proposals, proposalsByKey };
}

function deriveFindingResults(decisions) {
  const groups = new Map();
  for (const decision of decisions) {
    if (!["created", "matched"].includes(decision.disposition)) continue;
    const group = groups.get(decision.stable_finding_id) ?? {
      stable_finding_id: decision.stable_finding_id,
      proposals: [],
      report_pointers: [],
    };
    group.proposals.push(structuredClone(decision.proposal));
    group.report_pointers.push(decision.proposal.report_pointer);
    groups.set(decision.stable_finding_id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      proposals: group.proposals.sort((left, right) =>
        compareUnicode(proposalKey(left), proposalKey(right)),
      ),
      report_pointers: sortStrings(new Set(group.report_pointers)),
    }))
    .sort((left, right) => compareUnicode(left.stable_finding_id, right.stable_finding_id));
}

function deriveSummary(proposals, decisions) {
  const counts = {
    inventoried: proposals.length,
    created: 0,
    matched: 0,
    rejected: 0,
    blocked: 0,
    unresolved: proposals.length - decisions.length,
  };
  for (const decision of decisions) counts[decision.disposition] += 1;
  return counts;
}

function deriveProminentRisks(accounting) {
  return accounting.decisions
    .flatMap((decision) => {
      const entry = accounting.proposalsByKey.get(proposalKey(decision.proposal));
      if (!entry) return [];
      if (!["S1", "S2"].includes(entry.proposal.severity) && entry.proposal.priority !== "P0") {
        return [];
      }
      return [{
        proposal: structuredClone(decision.proposal),
        severity: entry.proposal.severity,
        priority: entry.proposal.priority,
        disposition: decision.disposition,
        stable_finding_id: decision.stable_finding_id ?? null,
        reason_code: decision.reason_code,
      }];
    })
    .sort((left, right) =>
      compareUnicode(proposalKey(left.proposal), proposalKey(right.proposal)),
    );
}

function artifactPublicationState(repositoryRoot, gitPath, commit, digest) {
  return {
    tracked: isTracked(repositoryRoot, gitPath),
    differs: digestAtCommit(repositoryRoot, commit, gitPath) !== digest,
  };
}

function buildReceipt({
  repositoryRoot,
  dispatch,
  inventory,
  envelope,
  project,
  candidate,
  accounting,
  receiptPath,
}) {
  const blocked = accounting.decisions.some(({ disposition }) => disposition === "blocked");
  const publicationHead = headCommit(repositoryRoot);
  const dispatchState = artifactPublicationState(
    repositoryRoot, dispatch.gitPath, publicationHead, dispatch.digest,
  );
  const inventoryState = artifactPublicationState(
    repositoryRoot, inventory.gitPath, publicationHead, inventory.digest,
  );
  const ledgerState = artifactPublicationState(
    repositoryRoot, project.ledgerGitPath, publicationHead, project.digest,
  );
  const receiptState = {
    tracked: isTracked(repositoryRoot, receiptPath),
    differs: true,
  };
  const summary = deriveSummary(accounting.proposals, accounting.decisions);
  if (summary.unresolved !== 0) throw new Error("receipt cannot retain unresolved proposals");
  if (
    accounting.decisions.some(({ disposition }) =>
      ["created", "matched"].includes(disposition),
    ) &&
    !candidate
  ) {
    throw new Error("created or matched decisions require a candidate ledger");
  }
  return {
    schema_version: PROTOCOL_VERSION,
    protocol: PROTOCOL,
    run_id: inventory.value.run_id,
    supersedes_run_id: envelope.supersedes_run_id,
    candidate: structuredClone(inventory.value.candidate),
    dispatch_manifest: {
      path: dispatch.gitPath,
      sha256: dispatch.digest,
    },
    inventory: {
      path: inventory.gitPath,
      sha256: inventory.digest,
    },
    ledger: {
      path: project.ledgerGitPath,
      schema_version_before: project.schemaVersion,
      schema_version_after: project.schemaVersion,
      sha256_before: project.digest,
      sha256_after: blocked ? null : candidate.digest,
      row_count_before: project.rows.length,
      row_count_after: blocked ? null : candidate.rows.length,
    },
    reconciled_at: envelope.reconciled_at,
    decisions: accounting.decisions,
    finding_results: deriveFindingResults(accounting.decisions),
    summary,
    prominent_risks: deriveProminentRisks(accounting),
    persistence: {
      publication_state: blocked ? "blocked-not-published" : "pending-human-commit",
      dispatch_manifest_tracked: dispatchState.tracked,
      inventory_tracked: inventoryState.tracked,
      receipt_tracked: receiptState.tracked,
      ledger_tracked: ledgerState.tracked,
      dispatch_manifest_differs_from_head: dispatchState.differs,
      inventory_differs_from_head: inventoryState.differs,
      receipt_differs_from_head: receiptState.differs,
      ledger_differs_from_head: blocked
        ? ledgerState.differs
        : digestAtCommit(repositoryRoot, publicationHead, project.ledgerGitPath) !==
          candidate.digest,
      head_commit_at_publication: publicationHead,
    },
  };
}

function transactionPaths(repositoryRoot, runId, project) {
  const runLocation = repositoryPath(
    repositoryRoot,
    `qa-reconciliation/${runId}`,
    "reconciliation run",
  );
  const runDirectory = runLocation.absolutePath;
  return {
    journal: resolve(runDirectory, ".transaction-journal.json"),
    journalGitPath: `${runLocation.gitPath}/.transaction-journal.json`,
    journalTemporary: resolve(runDirectory, ".transaction-journal.next"),
    journalTemporaryGitPath: `${runLocation.gitPath}/.transaction-journal.next`,
    ledgerLock: `${project.ledgerPath}.lock`,
    ledgerLockGitPath: `${project.ledgerGitPath}.lock`,
    ledgerStage: `${project.ledgerPath}.finding-reconciliation.stage`,
    ledgerStageGitPath: `${project.ledgerGitPath}.finding-reconciliation.stage`,
    receiptStage: resolve(runDirectory, ".reconciliation-receipt.stage"),
    receiptStageGitPath: `${runLocation.gitPath}/.reconciliation-receipt.stage`,
    runDirectory,
    runLock: resolve(runDirectory, ".reconciliation.lock"),
    runLockGitPath: `${runLocation.gitPath}/.reconciliation.lock`,
  };
}

function assertTransactionBoundaries(repositoryRoot, paths) {
  for (const [gitPath, label] of [
    [paths.journalGitPath, "transaction journal"],
    [paths.journalTemporaryGitPath, "transaction journal staging file"],
    [paths.ledgerStageGitPath, "candidate ledger staging file"],
    [paths.ledgerLockGitPath, "finding ledger lock"],
    [`${paths.ledgerLockGitPath}.stale-recovery`, "finding ledger stale-lock claim"],
    [`${paths.ledgerLockGitPath}.owner-example`, "finding ledger lock owner stage"],
    [paths.receiptStageGitPath, "candidate receipt staging file"],
    [paths.runLockGitPath, "reconciliation run lock"],
  ]) {
    assertIgnoredUntracked(repositoryRoot, gitPath, label);
  }
}

async function pathSource(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`reconciliation artifact must be a regular file: ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertExactFile(path, digest, label) {
  const source = await pathSource(path);
  if (source === undefined || sha256(source) !== digest) {
    throw new Error(`${label} is missing or does not match transaction digest`);
  }
  return source;
}

async function assertOptionalExactFile(path, digest, label) {
  const source = await pathSource(path);
  if (source !== undefined && sha256(source) !== digest) {
    throw new Error(`${label} contains an unexpected third digest; manual recovery required`);
  }
  return source;
}

async function assertNoUnknownStages(paths) {
  const allowedRunStages = new Set([
    ".reconciliation-receipt.stage",
    ".transaction-journal.next",
  ]);
  for (const name of await readdir(paths.runDirectory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if ((name.endsWith(".stage") || name.endsWith(".exclusive-stage")) &&
        !allowedRunStages.has(name)) {
      throw new Error(`unexpected reconciliation stage ${name}; manual recovery required`);
    }
  }
}

async function writeTransactionJournal(paths, journal) {
  const source = canonicalJsonDocument(journal);
  await writeAtomic(paths.journal, source, paths.journalTemporary);
}

async function stageExact(path, source, label) {
  try {
    await writeExclusive(path, source, 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await pathSource(path);
    if (existing !== source) throw new Error(`${label} stage contains unexpected bytes`);
  }
}

async function cleanupTransaction(paths) {
  for (const path of [
    paths.ledgerStage,
    paths.receiptStage,
    paths.journalTemporary,
    paths.journal,
  ]) {
    await unlinkDurable(path);
  }
}

async function publishTransaction({
  paths,
  project,
  candidateSource,
  receiptPath,
  receiptSource,
  inventoryDigest,
  inventoryPath,
  decisionDigest,
  decisionPath,
  runId,
  reconciledAt,
  faultAfterPhase,
}) {
  const ledgerDigest = sha256(candidateSource);
  const receiptDigest = sha256(receiptSource);
  await stageExact(paths.ledgerStage, candidateSource, "candidate ledger");
  await stageExact(paths.receiptStage, receiptSource, "candidate receipt");
  let journal = {
    schema_version: 1,
    protocol: PROTOCOL,
    run_id: runId,
    phase: "prepared",
    reconciled_at: reconciledAt,
    inventory: { path: inventoryPath, sha256: inventoryDigest },
    decision_envelope: { path: decisionPath, sha256: decisionDigest },
    ledger: {
      path: project.ledgerGitPath,
      stage_path: `${project.ledgerGitPath}.finding-reconciliation.stage`,
      sha256_before: project.digest,
      sha256_after: ledgerDigest,
    },
    receipt: {
      path: `qa-reconciliation/${runId}/reconciliation-receipt.json`,
      stage_path: `qa-reconciliation/${runId}/.reconciliation-receipt.stage`,
      sha256: receiptDigest,
    },
  };
  await writeTransactionJournal(paths, journal);
  if (faultAfterPhase === "prepared") throw new Error("injected failure after prepared");
  await renameDurable(paths.ledgerStage, project.ledgerPath);
  journal = { ...journal, phase: "ledger-published" };
  await writeTransactionJournal(paths, journal);
  if (faultAfterPhase === "ledger-published") {
    throw new Error("injected failure after ledger-published");
  }
  await renameDurable(paths.receiptStage, receiptPath);
  journal = { ...journal, phase: "receipt-published" };
  await writeTransactionJournal(paths, journal);
  if (faultAfterPhase === "receipt-published") {
    throw new Error("injected failure after receipt-published");
  }
  await assertExactFile(project.ledgerPath, ledgerDigest, "published ledger");
  await assertExactFile(receiptPath, receiptDigest, "published receipt");
  await cleanupTransaction(paths);
  return { ledgerDigest, receiptDigest };
}

function assertExactObjectKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !valuesEqual(Object.keys(value).sort(), [...keys].sort())
  ) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function validateJournal(journal) {
  assertExactObjectKeys(journal, [
    "schema_version", "protocol", "run_id", "phase", "reconciled_at",
    "inventory", "decision_envelope", "ledger", "receipt",
  ], "transaction journal");
  assertExactObjectKeys(journal.inventory, ["path", "sha256"], "journal inventory");
  assertExactObjectKeys(
    journal.decision_envelope,
    ["path", "sha256"],
    "journal decision envelope",
  );
  assertExactObjectKeys(
    journal.ledger,
    ["path", "stage_path", "sha256_before", "sha256_after"],
    "journal ledger",
  );
  assertExactObjectKeys(
    journal.receipt,
    ["path", "stage_path", "sha256"],
    "journal receipt",
  );
  const digests = [
    journal.inventory.sha256,
    journal.decision_envelope.sha256,
    journal.ledger.sha256_before,
    journal.ledger.sha256_after,
    journal.receipt.sha256,
  ];
  if (
    journal.schema_version !== 1 ||
    journal.protocol !== PROTOCOL ||
    !["prepared", "ledger-published", "receipt-published"].includes(journal.phase) ||
    !digests.every((digest) => /^[0-9a-f]{64}$/u.test(digest))
  ) {
    throw new Error("transaction journal is malformed or has an unrecognized phase");
  }
  return journal;
}

function journalIdentity(journal) {
  const identity = structuredClone(journal);
  delete identity.phase;
  return identity;
}

async function readTransactionJournal(paths) {
  const [source, nextSource] = await Promise.all([
    pathSource(paths.journal),
    pathSource(paths.journalTemporary),
  ]);
  if (source === undefined && nextSource === undefined) return null;
  const journal = source === undefined
    ? null
    : validateJournal(parseJsonStrict(source, paths.journal));
  const next = nextSource === undefined
    ? null
    : validateJournal(parseJsonStrict(nextSource, paths.journalTemporary));
  if (next) {
    if (journal && !valuesEqual(journalIdentity(journal), journalIdentity(next))) {
      throw new Error("transaction journal staging identity conflicts with journal");
    }
    const phases = ["prepared", "ledger-published", "receipt-published"];
    if (journal && phases.indexOf(next.phase) < phases.indexOf(journal.phase)) {
      throw new Error("transaction journal staging phase moved backward");
    }
    await renameDurable(paths.journalTemporary, paths.journal);
    return next;
  }
  return journal;
}

function ledgerSnapshotByDigest(repositoryRoot, project, digest) {
  for (const commit of candidateCommitsForPaths(repositoryRoot, [project.ledgerGitPath])) {
    const source = readFileAtCommit(repositoryRoot, commit, project.ledgerGitPath);
    if (source !== undefined && sha256(source) === digest) return source;
  }
  throw new Error(`ledger snapshot ${digest} is not available for semantic recovery`);
}

async function validateRecoveryInputs(
  repositoryRoot,
  context,
  project,
  journal,
  paths,
  schemas,
  expected,
) {
  if (
    journal.ledger.stage_path !== paths.ledgerStageGitPath ||
    journal.receipt.stage_path !== paths.receiptStageGitPath ||
    journal.receipt.path !== expectedArtifactPath(journal.run_id, "reconciliation-receipt.json")
  ) {
    throw new Error("transaction journal paths do not match deterministic recovery paths");
  }
  const inventory = await loadInventory(
    repositoryRoot,
    journal.inventory.path,
    schemas,
  );
  const decision = await loadDecisionEnvelope(
    repositoryRoot,
    journal.decision_envelope.path,
    schemas.decisions,
  );
  if (
    inventory.value.run_id !== journal.run_id ||
    inventory.digest !== journal.inventory.sha256 ||
    decision.digest !== journal.decision_envelope.sha256 ||
    (expected?.inventoryDigest && expected.inventoryDigest !== inventory.digest) ||
    (expected?.decisionDigest && expected.decisionDigest !== decision.digest)
  ) {
    throw new Error("transaction journal is not bound to the requested frozen inputs");
  }
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    inventory.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (dispatch.digest !== inventory.value.dispatch_manifest.sha256) {
    throw new Error("recovery dispatch digest does not match inventory");
  }
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  if (
    decision.value.run_id !== journal.run_id ||
    decision.value.inventory.path !== inventory.gitPath ||
    decision.value.inventory.sha256 !== inventory.digest ||
    !valuesEqual(decision.value.candidate, inventory.value.candidate) ||
    decision.value.reconciled_at !== journal.reconciled_at
  ) {
    throw new Error("recovery decision identity does not match journal and inventory");
  }
  const currentSource = await readFile(project.ledgerPath, "utf8");
  const currentDigest = sha256(currentSource);
  const priorSource = currentDigest === journal.ledger.sha256_before
    ? currentSource
    : ledgerSnapshotByDigest(repositoryRoot, project, journal.ledger.sha256_before);
  const candidateSource = await pathSource(paths.ledgerStage) ??
    (currentDigest === journal.ledger.sha256_after ? currentSource : undefined);
  if (!candidateSource || sha256(candidateSource) !== journal.ledger.sha256_after) {
    throw new Error("candidate ledger bytes are unavailable or conflict with the journal");
  }
  const priorRows = parseJsonl(priorSource, "recovery prior ledger");
  const candidateRows = parseJsonl(candidateSource, "recovery candidate ledger");
  validateFindingRows(priorRows, project.schema, project);
  validateFindingRows(candidateRows, project.schema, project);
  assertLedgerTransition(priorRows, candidateRows);
  const candidate = {
    digest: journal.ledger.sha256_after,
    rows: candidateRows,
    source: candidateSource,
  };
  const changesLedger = decision.value.decisions.some(({ disposition }) =>
    ["created", "matched"].includes(disposition),
  );
  if (changesLedger) {
    if (
      decision.value.candidate_ledger === null ||
      decision.value.candidate_ledger.sha256 !== candidate.digest
    ) {
      throw new Error("recovery decision candidate ledger does not match staged bytes");
    }
    const candidateArtifact = await readRepositoryFile(
      repositoryRoot,
      decision.value.candidate_ledger.path,
      "recovery decision candidate ledger",
    );
    assertIgnoredUntracked(
      repositoryRoot,
      candidateArtifact.gitPath,
      "recovery decision candidate ledger",
    );
    if (sha256(candidateArtifact.source) !== candidate.digest) {
      throw new Error("recovery decision candidate ledger source drifted");
    }
  } else {
    if (
      candidate.digest !== journal.ledger.sha256_before ||
      !valuesEqual(candidateRows, priorRows)
    ) {
      throw new Error("recovery no-change decision must preserve the exact prior ledger");
    }
    if (decision.value.candidate_ledger !== null) {
      const candidateArtifact = await readRepositoryFile(
        repositoryRoot,
        decision.value.candidate_ledger.path,
        "recovery no-change candidate ledger",
      );
      assertIgnoredUntracked(
        repositoryRoot,
        candidateArtifact.gitPath,
        "recovery no-change candidate ledger",
      );
      if (
        decision.value.candidate_ledger.sha256 !== candidate.digest ||
        candidateArtifact.source !== candidate.source
      ) {
        throw new Error("recovery no-change candidate ledger does not equal prior bytes");
      }
    }
  }
  const priorProject = { ...project, digest: journal.ledger.sha256_before, rows: priorRows };
  await validateSupersededRun({
    repositoryRoot,
    context,
    envelope: decision.value,
    schemas,
  });
  const accounting = verifyDecisionAccounting(
    inventory.value,
    decision.value,
    priorRows,
    candidate,
  );
  const receiptPath = repositoryPath(
    repositoryRoot,
    journal.receipt.path,
    "journal receipt",
  ).absolutePath;
  const receiptSource = await pathSource(receiptPath) ?? await pathSource(paths.receiptStage);
  if (!receiptSource || sha256(receiptSource) !== journal.receipt.sha256) {
    throw new Error("candidate receipt bytes are unavailable or conflict with the journal");
  }
  const receipt = parseJsonStrict(receiptSource, "recovery receipt");
  validateJsonDocument(receipt, schemas.receipt, "recovery receipt");
  assertSafeStrings(receipt, "recovery receipt");
  const expectedReceipt = buildReceipt({
    repositoryRoot,
    dispatch,
    inventory,
    envelope: decision.value,
    project: priorProject,
    candidate,
    accounting,
    receiptPath: journal.receipt.path,
  });
  expectedReceipt.persistence = structuredClone(receipt.persistence);
  const publicationHead = receipt.persistence.head_commit_at_publication;
  const expectedPersistenceDiffs = {
    dispatch_manifest_differs_from_head:
      digestAtCommit(repositoryRoot, publicationHead, dispatch.gitPath) !== dispatch.digest,
    inventory_differs_from_head:
      digestAtCommit(repositoryRoot, publicationHead, inventory.gitPath) !== inventory.digest,
    receipt_differs_from_head:
      digestAtCommit(repositoryRoot, publicationHead, journal.receipt.path) !== journal.receipt.sha256,
    ledger_differs_from_head:
      digestAtCommit(repositoryRoot, publicationHead, project.ledgerGitPath) !== candidate.digest,
  };
  if (
    receipt.persistence.publication_state !== "pending-human-commit" ||
    receipt.persistence.ledger_tracked !== true ||
    Object.entries(expectedPersistenceDiffs).some(
      ([field, expectedValue]) => receipt.persistence[field] !== expectedValue,
    )
  ) {
    throw new Error("candidate receipt has inconsistent frozen persistence metadata");
  }
  if (receiptSource !== canonicalJsonDocument(expectedReceipt)) {
    throw new Error("candidate receipt fails semantic recovery accounting");
  }
  return { receiptPath };
}

async function recoverTransaction(
  repositoryRoot,
  context,
  project,
  runId,
  paths,
  schemas,
  expected,
) {
  const journal = await readTransactionJournal(paths);
  if (!journal) return { recovered: false };
  if (journal.run_id !== runId || journal.ledger.path !== project.ledgerGitPath) {
    throw new Error("transaction journal identity does not match requested recovery");
  }
  await assertNoUnknownStages(paths);
  await assertOptionalExactFile(paths.ledgerStage, journal.ledger.sha256_after, "staged ledger");
  await assertOptionalExactFile(paths.receiptStage, journal.receipt.sha256, "staged receipt");
  const { receiptPath } = await validateRecoveryInputs(
    repositoryRoot,
    context,
    project,
    journal,
    paths,
    schemas,
    expected,
  );
  const currentLedger = await readFile(project.ledgerPath, "utf8");
  const ledgerDigest = sha256(currentLedger);
  const receiptSource = await pathSource(receiptPath);
  const receiptDigest = receiptSource === undefined ? null : sha256(receiptSource);
  if (receiptDigest !== null && receiptDigest !== journal.receipt.sha256) {
    throw new Error("published receipt has unexpected bytes; manual recovery required");
  }
  if (receiptDigest !== null && ledgerDigest !== journal.ledger.sha256_after) {
    throw new Error("receipt exists without its candidate ledger; manual recovery required");
  }
  if (ledgerDigest === journal.ledger.sha256_before && receiptDigest === null) {
    await assertExactFile(paths.ledgerStage, journal.ledger.sha256_after, "staged ledger");
    await assertExactFile(paths.receiptStage, journal.receipt.sha256, "staged receipt");
    await renameDurable(paths.ledgerStage, project.ledgerPath);
    await writeTransactionJournal(paths, { ...journal, phase: "ledger-published" });
    await renameDurable(paths.receiptStage, receiptPath);
    await writeTransactionJournal(paths, { ...journal, phase: "receipt-published" });
  } else if (ledgerDigest === journal.ledger.sha256_after && receiptDigest === null) {
    await assertExactFile(paths.receiptStage, journal.receipt.sha256, "staged receipt");
    await renameDurable(paths.receiptStage, receiptPath);
    await writeTransactionJournal(paths, { ...journal, phase: "receipt-published" });
  } else if (
    ledgerDigest !== journal.ledger.sha256_after ||
    receiptDigest !== journal.receipt.sha256
  ) {
    throw new Error("transaction bytes are in an unknown state; manual recovery required");
  }
  await assertExactFile(project.ledgerPath, journal.ledger.sha256_after, "recovered ledger");
  await assertExactFile(receiptPath, journal.receipt.sha256, "recovered receipt");
  await assertOptionalExactFile(paths.ledgerStage, journal.ledger.sha256_after, "staged ledger");
  await assertOptionalExactFile(paths.receiptStage, journal.receipt.sha256, "staged receipt");
  await cleanupTransaction(paths);
  return {
    recovered: true,
    ledgerDigest: journal.ledger.sha256_after,
    receiptDigest: journal.receipt.sha256,
    receiptPath: journal.receipt.path,
  };
}

async function existingReconciliationResult({
  repositoryRoot,
  context,
  receiptLocation,
  receiptGitPath,
  schemas,
  inventory,
  dispatch,
  decision,
  project,
}) {
  const source = await pathSource(receiptLocation.absolutePath);
  if (source === undefined) return null;
  const receipt = parseJsonStrict(source, receiptGitPath);
  validateJsonDocument(receipt, schemas.receipt, "existing reconciliation receipt");
  const expectedDecisions = normalizeDecisions(decision.value);
  if (
    receipt.run_id !== inventory.value.run_id ||
    receipt.inventory.path !== inventory.gitPath ||
    receipt.inventory.sha256 !== inventory.digest ||
    receipt.dispatch_manifest.path !== dispatch.gitPath ||
    receipt.dispatch_manifest.sha256 !== dispatch.digest ||
    receipt.reconciled_at !== decision.value.reconciled_at ||
    receipt.supersedes_run_id !== decision.value.supersedes_run_id ||
    !valuesEqual(receipt.candidate, decision.value.candidate) ||
    !valuesEqual(receipt.decisions, expectedDecisions)
  ) {
    throw new Error("existing reconciliation receipt conflicts with frozen inputs");
  }
  await validateReceiptSemantics(
    repositoryRoot,
    context,
    {
      digest: sha256(source),
      gitPath: receiptGitPath,
      source,
      value: receipt,
    },
    inventory,
    dispatch,
    project,
    schemas,
  );
  const expectedCurrentDigest =
    receipt.ledger.sha256_after ?? receipt.ledger.sha256_before;
  if (project.digest !== expectedCurrentDigest) {
    throw new Error("existing receipt does not match the current finding ledger");
  }
  if (
    decision.value.candidate_ledger !== null &&
    receipt.ledger.sha256_after !== null &&
    decision.value.candidate_ledger.sha256 !== receipt.ledger.sha256_after
  ) {
    throw new Error("existing receipt does not match the candidate ledger digest");
  }
  return {
    ledgerDigest: receipt.ledger.sha256_after,
    receipt,
    receiptDigest: sha256(source),
    receiptPath: receiptGitPath,
    result: "existing",
  };
}

async function validateSupersededRun({
  repositoryRoot,
  envelope,
  schemas,
}) {
  const supersededRunId = envelope.supersedes_run_id;
  if (supersededRunId === null) return;
  if (supersededRunId === envelope.run_id) {
    throw new Error("a reconciliation run cannot supersede itself");
  }
  const priorReceiptPath = expectedArtifactPath(
    supersededRunId,
    "reconciliation-receipt.json",
  );
  const prior = await readValidatedJson(
    repositoryRoot,
    priorReceiptPath,
    schemas.receipt,
    "superseded reconciliation receipt",
  );
  if (prior.value.run_id !== supersededRunId) {
    throw new Error("superseded receipt run identity does not match its path");
  }
  if (!await durableReceiptCommit(repositoryRoot, prior, schemas)) {
    throw new Error("superseded reconciliation must be durable before correction");
  }
}

export async function recoverReconciliation({
  repository = ".",
  context = "qa-context.md",
  runId,
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const project = await validateProject({ repository: repositoryRoot, context });
  const paths = transactionPaths(repositoryRoot, runId, project);
  assertTransactionBoundaries(repositoryRoot, paths);
  return withExclusiveLocks(
    [paths.runLock, paths.ledgerLock],
    { pid: process.pid, operation: "recover", run_id: runId },
    () => recoverTransaction(
      repositoryRoot,
      context,
      project,
      runId,
      paths,
      schemas,
    ),
  );
}

export async function reconcileFindings({
  repository = ".",
  context = "qa-context.md",
  inventoryPath,
  decisionPath,
  faultAfterPhase,
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const inventory = await loadInventory(repositoryRoot, inventoryPath, schemas);
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    inventory.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (dispatch.digest !== inventory.value.dispatch_manifest.sha256) {
    throw new Error("dispatch manifest digest does not match proposal inventory");
  }
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  const decision = await loadDecisionEnvelope(
    repositoryRoot,
    decisionPath,
    schemas.decisions,
  );
  for (const [field, expected] of [
    ["run_id", inventory.value.run_id],
  ]) {
    if (decision.value[field] !== expected) {
      throw new Error(`decision envelope ${field} does not match inventory`);
    }
  }
  if (!valuesEqual(decision.value.candidate, inventory.value.candidate)) {
    throw new Error("decision envelope candidate does not match inventory");
  }
  if (
    decision.value.inventory.path !== inventory.gitPath ||
    decision.value.inventory.sha256 !== inventory.digest
  ) {
    throw new Error("decision envelope inventory identity does not match frozen bytes");
  }
  const initialProject = await validateProject({ repository: repositoryRoot, context });
  if (
    initialProject.ledgerGitPath !== inventory.value.previous_ledger.path ||
    initialProject.schemaVersion !== inventory.value.previous_ledger.schema_version
  ) {
    throw new Error("finding ledger location or schema drifted from the frozen inventory");
  }
  const paths = transactionPaths(repositoryRoot, inventory.value.run_id, initialProject);
  assertTransactionBoundaries(repositoryRoot, paths);
  const receiptGitPath = expectedArtifactPath(
    inventory.value.run_id,
    "reconciliation-receipt.json",
  );
  const receiptLocation = await assertCreationPath(
    repositoryRoot,
    receiptGitPath,
    "reconciliation receipt",
  );
  assertTrackable(repositoryRoot, receiptGitPath, "reconciliation receipt");
  return withExclusiveLocks(
    [paths.runLock, paths.ledgerLock],
    {
      pid: process.pid,
      operation: "reconcile",
      run_id: inventory.value.run_id,
      inventory_sha256: inventory.digest,
      decision_envelope_sha256: decision.digest,
    },
    async () => {
      const recovered = await recoverTransaction(
        repositoryRoot,
        context,
        initialProject,
        inventory.value.run_id,
        paths,
        schemas,
        { inventoryDigest: inventory.digest, decisionDigest: decision.digest },
      );
      if (recovered.recovered) return recovered;
      const [currentInventorySource, currentDispatchSource, currentDecisionSource] =
        await Promise.all([
          readFile(inventory.absolutePath, "utf8"),
          readFile(dispatch.absolutePath, "utf8"),
          readFile(decision.absolutePath, "utf8"),
        ]);
      if (
        sha256(currentInventorySource) !== inventory.digest ||
        sha256(currentDispatchSource) !== dispatch.digest ||
        sha256(currentDecisionSource) !== decision.digest
      ) {
        throw new Error("frozen reconciliation input changed while waiting for locks");
      }
      await verifyInventorySources(
        repositoryRoot,
        inventory.value,
        dispatch.value,
        schemas,
      );
      const project = await validateProject({ repository: repositoryRoot, context });
      const existing = await existingReconciliationResult({
        repositoryRoot,
        context,
        receiptLocation,
        receiptGitPath,
        schemas,
        inventory,
        dispatch,
        decision,
        project,
      });
      if (existing) return existing;
      if (
        project.digest !== inventory.value.previous_ledger.sha256 ||
        project.rows.length !== inventory.value.previous_ledger.row_count ||
        project.schemaVersion !== inventory.value.previous_ledger.schema_version
      ) {
        throw new Error("finding ledger changed concurrently after inventory freeze");
      }
      await validateSupersededRun({
        repositoryRoot,
        context,
        envelope: decision.value,
        schemas,
      });
      const candidate = await loadCandidateLedger(
        repositoryRoot,
        context,
        decision.value,
        project,
      );
      const accounting = verifyDecisionAccounting(
        inventory.value,
        decision.value,
        project.rows,
        candidate,
      );
      const changesLedger = accounting.decisions.some(({ disposition }) =>
        ["created", "matched"].includes(disposition),
      );
      const hasBlocked = accounting.decisions.some(
        ({ disposition }) => disposition === "blocked",
      );
      const publicationCandidate =
        candidate ??
        (!changesLedger && !hasBlocked
          ? {
              digest: project.digest,
              rows: project.rows,
              source: await readFile(project.ledgerPath, "utf8"),
            }
          : null);
      const receipt = buildReceipt({
        repositoryRoot,
        dispatch,
        inventory,
        envelope: decision.value,
        project,
        candidate: publicationCandidate,
        accounting,
        receiptPath: receiptGitPath,
      });
      validateJsonDocument(receipt, schemas.receipt, "reconciliation receipt");
      assertSafeStrings(receipt, "reconciliation receipt");
      const receiptSource = canonicalJsonDocument(receipt);
      if (receipt.persistence.publication_state === "blocked-not-published") {
        const result = await writeExclusiveIdempotent(
          receiptLocation.absolutePath,
          receiptSource,
          `reconciliation receipt for run ${receipt.run_id}`,
        );
        return {
          receipt,
          receiptDigest: sha256(receiptSource),
          receiptPath: receiptGitPath,
          result,
        };
      }
      const published = await publishTransaction({
        paths,
        project,
        candidateSource: publicationCandidate.source,
        receiptPath: receiptLocation.absolutePath,
        receiptSource,
        inventoryDigest: inventory.digest,
        inventoryPath: inventory.gitPath,
        decisionDigest: decision.digest,
        decisionPath: decision.gitPath,
        runId: inventory.value.run_id,
        reconciledAt: decision.value.reconciled_at,
        faultAfterPhase,
      });
      return {
        ledgerDigest: published.ledgerDigest,
        receipt,
        receiptDigest: published.receiptDigest,
        receiptPath: receiptGitPath,
        result: "published",
      };
    },
  );
}

function digestAtCommit(repositoryRoot, commit, gitPath) {
  const source = readFileAtCommit(repositoryRoot, commit, gitPath);
  return source === undefined ? undefined : sha256(source);
}

async function durableReceiptCommit(repositoryRoot, receipt, schemas) {
  const inventory = await loadInventory(
    repositoryRoot,
    receipt.value.inventory.path,
    schemas,
  );
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    receipt.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (
    inventory.digest !== receipt.value.inventory.sha256 ||
    dispatch.digest !== receipt.value.dispatch_manifest.sha256
  ) return null;
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  const expected = new Map([
    [dispatch.gitPath, dispatch.digest],
    [inventory.gitPath, inventory.digest],
    [receipt.gitPath, receipt.digest],
    [receipt.value.ledger.path,
      receipt.value.ledger.sha256_after ?? receipt.value.ledger.sha256_before],
  ]);
  for (const commit of candidateCommitsForPaths(repositoryRoot, [...expected.keys()])) {
    if ([...expected].every(
      ([path, digest]) => digestAtCommit(repositoryRoot, commit, path) === digest,
    )) return commit;
  }
  return null;
}

async function reconciliationResidues(paths, artifacts) {
  const fixed = [
    paths.journal,
    paths.journalTemporary,
    paths.ledgerStage,
    paths.receiptStage,
    paths.runLock,
    paths.ledgerLock,
    `${paths.runLock}.stale-recovery`,
    `${paths.ledgerLock}.stale-recovery`,
    ...artifacts.map((path) =>
      resolve(dirname(path), `.${basename(path)}.exclusive-stage`),
    ),
  ];
  const present = [];
  for (const path of fixed) {
    if (await pathSource(path) !== undefined) present.push(path);
  }
  const ownerPrefixes = new Set([
    `.${basename(paths.runLock)}.owner-`,
    `.${basename(paths.ledgerLock)}.owner-`,
  ]);
  const staleNames = new Set([
    basename(`${paths.runLock}.stale-recovery`),
    basename(`${paths.ledgerLock}.stale-recovery`),
  ]);
  for (const directory of new Set([paths.runDirectory, dirname(paths.ledgerLock)])) {
    for (const name of await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if ([...ownerPrefixes].some((prefix) => name.startsWith(prefix)) || staleNames.has(name)) {
        present.push(resolve(directory, name));
      }
    }
  }
  return sortStrings(new Set(present));
}

async function validateReceiptSemantics(
  repositoryRoot,
  context,
  receipt,
  inventory,
  dispatch,
  project,
  schemas,
) {
  if (receipt.source !== canonicalJsonDocument(receipt.value)) {
    throw new Error("reconciliation receipt bytes are not canonical");
  }
  if (
    receipt.value.run_id !== inventory.value.run_id ||
    !valuesEqual(receipt.value.candidate, inventory.value.candidate) ||
    receipt.value.dispatch_manifest.path !== inventory.value.dispatch_manifest.path ||
    receipt.value.dispatch_manifest.sha256 !== inventory.value.dispatch_manifest.sha256 ||
    receipt.value.ledger.path !== project.ledgerGitPath ||
    inventory.value.previous_ledger.path !== receipt.value.ledger.path ||
    inventory.value.previous_ledger.sha256 !== receipt.value.ledger.sha256_before ||
    inventory.value.previous_ledger.row_count !== receipt.value.ledger.row_count_before ||
    inventory.value.previous_ledger.schema_version !== receipt.value.ledger.schema_version_before
  ) {
    throw new Error("receipt identity does not match inventory and ledger predecessor");
  }
  const currentSource = await readFile(project.ledgerPath, "utf8");
  const currentDigest = sha256(currentSource);
  const sourceFor = (digest) => currentDigest === digest
    ? currentSource
    : ledgerSnapshotByDigest(repositoryRoot, project, digest);
  const priorSource = sourceFor(receipt.value.ledger.sha256_before);
  const priorRows = parseJsonl(priorSource, "receipt predecessor ledger");
  if (receipt.value.ledger.schema_version_before !== receipt.value.ledger.schema_version_after) {
    throw new Error("reconciliation receipt cannot claim an implicit ledger schema migration");
  }
  const historicalSchema = await loadFindingSchema(
    receipt.value.ledger.schema_version_before,
  );
  const historicalProject = {
    ...project,
    schema: historicalSchema,
    schemaVersion: receipt.value.ledger.schema_version_before,
  };
  validateFindingRows(priorRows, historicalSchema, historicalProject);
  let candidate = null;
  if (receipt.value.ledger.sha256_after !== null) {
    const candidateSource = sourceFor(receipt.value.ledger.sha256_after);
    const candidateRows = parseJsonl(candidateSource, "receipt candidate ledger");
    validateFindingRows(candidateRows, historicalSchema, historicalProject);
    assertLedgerTransition(priorRows, candidateRows);
    candidate = {
      digest: receipt.value.ledger.sha256_after,
      rows: candidateRows,
      source: candidateSource,
    };
    if (
      receipt.value.ledger.row_count_after !== candidateRows.length ||
      receipt.value.ledger.schema_version_after !== historicalProject.schemaVersion ||
      receipt.value.persistence.publication_state !== "pending-human-commit"
    ) {
      throw new Error("receipt candidate ledger metadata is inconsistent");
    }
  } else if (
    receipt.value.ledger.row_count_after !== null ||
    receipt.value.ledger.schema_version_after !== historicalProject.schemaVersion ||
    receipt.value.persistence.publication_state !== "blocked-not-published"
  ) {
    throw new Error("blocked receipt ledger publication metadata is inconsistent");
  }
  const accounting = verifyDecisionAccounting(
    inventory.value,
    { decisions: receipt.value.decisions },
    priorRows,
    candidate,
  );
  if (
    !valuesEqual(receipt.value.summary, deriveSummary(accounting.proposals, accounting.decisions)) ||
    !valuesEqual(receipt.value.finding_results, deriveFindingResults(accounting.decisions)) ||
    !valuesEqual(receipt.value.prominent_risks, deriveProminentRisks(accounting))
  ) {
    throw new Error("receipt derived accounting is inconsistent");
  }
  if (receipt.value.supersedes_run_id !== null) {
    const supersededPath = expectedArtifactPath(
      receipt.value.supersedes_run_id,
      "reconciliation-receipt.json",
    );
    if (receipt.value.supersedes_run_id === receipt.value.run_id) {
      throw new Error("a reconciliation receipt cannot supersede itself");
    }
    const prior = await readValidatedJson(
      repositoryRoot,
      supersededPath,
      schemas.receipt,
      "superseded reconciliation receipt",
    );
    if (prior.value.run_id !== receipt.value.supersedes_run_id) {
      throw new Error("superseded receipt run identity does not match its path");
    }
    if (!await durableReceiptCommit(repositoryRoot, prior, schemas)) {
      throw new Error("superseded reconciliation receipt is not durable");
    }
  }
}

export async function verifyReconciliationPersistence({
  repository = ".",
  context = "qa-context.md",
  receiptPath,
}) {
  const repositoryRoot = await resolveRepository(repository);
  const schemas = await loadSchemas();
  const receipt = await readValidatedJson(
    repositoryRoot,
    receiptPath,
    schemas.receipt,
    "reconciliation receipt",
  );
  const inventory = await loadInventory(
    repositoryRoot,
    receipt.value.inventory.path,
    schemas,
  );
  const dispatch = await loadCanonicalDispatch(
    repositoryRoot,
    receipt.value.dispatch_manifest.path,
    schemas.dispatch,
  );
  if (
    inventory.digest !== receipt.value.inventory.sha256 ||
    dispatch.digest !== receipt.value.dispatch_manifest.sha256
  ) {
    throw new Error("receipt artifact digests do not match current frozen bytes");
  }
  validateInventorySemantics(repositoryRoot, inventory.value, dispatch.value);
  const project = await validateProject({ repository: repositoryRoot, context });
  await validateReceiptSemantics(
    repositoryRoot,
    context,
    receipt,
    inventory,
    dispatch,
    project,
    schemas,
  );
  const transaction = transactionPaths(repositoryRoot, receipt.value.run_id, project);
  assertTransactionBoundaries(repositoryRoot, transaction);
  const residues = await reconciliationResidues(transaction, [
    dispatch.absolutePath,
    inventory.absolutePath,
    receipt.absolutePath,
  ]);
  if (residues.length > 0) {
    return {
      persistenceState: "blocked-recovery-required",
      durableCommit: null,
      artifacts: {},
      reason: `recovery residue remains: ${residues.join(", ")}`,
      receipt: receipt.value,
    };
  }
  const expectedLedgerDigest =
    receipt.value.ledger.sha256_after ?? receipt.value.ledger.sha256_before;
  const expectedDigests = new Map([
    [dispatch.gitPath, dispatch.digest],
    [inventory.gitPath, inventory.digest],
    [receipt.gitPath, receipt.digest],
    [project.ledgerGitPath, expectedLedgerDigest],
  ]);
  const paths = [...expectedDigests.keys()];
  let durableCommit = null;
  for (const commit of candidateCommitsForPaths(repositoryRoot, paths)) {
    if (
      paths.every(
        (path) => digestAtCommit(repositoryRoot, commit, path) === expectedDigests.get(path),
      )
    ) {
      durableCommit = commit;
      break;
    }
  }
  const currentExact = await Promise.all(
    paths.map(async (path) => {
      const source = await readRepositoryFile(repositoryRoot, path, path);
      return sha256(source.source) === expectedDigests.get(path);
    }),
  );
  const states = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        tracked: isTracked(repositoryRoot, path),
        differs_from_head: differsFromHead(repositoryRoot, path),
      },
    ]),
  );
  if (durableCommit) {
    return {
      persistenceState: "durable-committed",
      durableCommit,
      artifacts: states,
      receipt: receipt.value,
    };
  }
  if (currentExact.every(Boolean)) {
    return {
      persistenceState: "pending-human-commit",
      durableCommit: null,
      artifacts: states,
      receipt: receipt.value,
    };
  }
  return {
    persistenceState: "blocked-recovery-required",
    durableCommit: null,
    artifacts: states,
    reason: "working artifacts do not match the receipt",
    receipt: receipt.value,
  };
}

function parseOptions(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`option --${name} requires a value`);
    }
    if (options[name] !== undefined) throw new Error(`duplicate option --${name}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  if (options[name] === undefined) throw new Error(`missing --${name}`);
  return options[name];
}

function assertAllowedOptions(options, allowed) {
  const unexpected = Object.keys(options).find((name) => !allowed.has(name));
  if (unexpected) throw new Error(`unsupported option --${unexpected}`);
}

async function readInputJson(path, label) {
  return parseJsonStrict(await readFile(resolve(path), "utf8"), label);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  const common = {
    repository: options.repo ?? ".",
    context: options.context ?? "qa-context.md",
  };
  if (command === "dispatch") {
    assertAllowedOptions(options, new Set(["repo", "input"]));
    const input = requiredOption(options, "input");
    const result = await freezeDispatchManifest({
      repository: common.repository,
      manifest: await readInputJson(input, input),
    });
    console.log(JSON.stringify({ path: result.path, sha256: result.digest, result: result.result }));
    return;
  }
  if (command === "inventory") {
    assertAllowedOptions(
      options,
      new Set(["repo", "context", "dispatch", "created-at", "unexecuted"]),
    );
    const unexecuted = options.unexecuted
      ? await readInputJson(options.unexecuted, options.unexecuted)
      : [];
    const result = await createProposalInventory({
      ...common,
      dispatchPath: requiredOption(options, "dispatch"),
      createdAt: requiredOption(options, "created-at"),
      unexecuted,
    });
    console.log(JSON.stringify({ path: result.path, sha256: result.digest, result: result.result }));
    return;
  }
  if (command === "review") {
    assertAllowedOptions(
      options,
      new Set(["repo", "context", "inventory", "component"]),
    );
    const result = await buildSemanticDecisionTask({
      ...common,
      inventoryPath: requiredOption(options, "inventory"),
      component: requiredOption(options, "component"),
    });
    process.stdout.write(canonicalJsonDocument(result));
    return;
  }
  if (command === "materialize") {
    assertAllowedOptions(
      options,
      new Set([
        "repo",
        "context",
        "inventory",
        "decisions",
        "candidate-ledger",
        "output",
      ]),
    );
    const result = await materializeCandidateLedger({
      ...common,
      inventoryPath: requiredOption(options, "inventory"),
      decisionPath: requiredOption(options, "decisions"),
      candidateLedgerPath: requiredOption(options, "candidate-ledger"),
      outputDecisionPath: requiredOption(options, "output"),
    });
    console.log(JSON.stringify({
      decision_path: result.decisionPath,
      decision_sha256: result.decisionDigest,
      candidate_ledger_path: result.candidateLedgerPath,
      candidate_ledger_sha256: result.candidateLedgerDigest,
    }));
    return;
  }
  if (command === "reconcile") {
    assertAllowedOptions(
      options,
      new Set(["repo", "context", "inventory", "decisions"]),
    );
    const result = await reconcileFindings({
      ...common,
      inventoryPath: requiredOption(options, "inventory"),
      decisionPath: requiredOption(options, "decisions"),
    });
    console.log(JSON.stringify({
      path: result.receiptPath,
      receipt_sha256: result.receiptDigest,
      ledger_sha256: result.ledgerDigest ?? null,
      result: result.result ?? (result.recovered ? "recovered" : "verified"),
    }));
    return;
  }
  if (command === "recover") {
    assertAllowedOptions(options, new Set(["repo", "context", "run-id"]));
    console.log(JSON.stringify(await recoverReconciliation({
      ...common,
      runId: requiredOption(options, "run-id"),
    })));
    return;
  }
  if (command === "verify") {
    assertAllowedOptions(options, new Set(["repo", "context", "receipt"]));
    console.log(JSON.stringify(await verifyReconciliationPersistence({
      ...common,
      receiptPath: requiredOption(options, "receipt"),
    })));
    return;
  }
  throw new Error(
    "command must be dispatch, inventory, review, materialize, reconcile, recover, or verify",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
