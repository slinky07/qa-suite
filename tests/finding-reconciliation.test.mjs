import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildSemanticDecisionTask,
  createProposalInventory,
  freezeDispatchManifest,
  materializeCandidateLedger,
  reconcileFindings,
  verifyReconciliationPersistence,
} from "../qa-suite/scripts/finding-reconciliation.mjs";
import {
  canonicalJson,
  canonicalJsonDocument,
  sha256,
} from "../qa-suite/scripts/lib/json-contract.mjs";
import { withExclusiveLocks } from "../qa-suite/scripts/lib/repository-artifacts.mjs";

const createdRepositories = [];
const timestamp = "2026-08-06T18:00:00Z";

function runGit(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function findingRow({
  id,
  candidate,
  reports,
  lane = "bob-qa",
  component = "clock-grid",
}) {
  return {
    id,
    schema_version: 2,
    lane,
    severity: "S3",
    priority: "P1",
    component,
    location: "World clock grid",
    oracle: "Each evidenced defect identity remains independently actionable.",
    status: "open",
    status_reason: null,
    candidate_first_seen: candidate,
    candidate_last_confirmed: candidate,
    first_seen: timestamp,
    last_seen: timestamp,
    occurrences: 1,
    defect_record: {
      actual_result: "The observed behavior violates the named oracle.",
      environment: "Synthetic deterministic fixture",
      expected_result: "The named behavior should remain correct.",
      repro_steps: ["Open the synthetic fixture.", "Observe the clock grid."],
    },
    reports,
    sensitivity: {
      classification: "standard",
      clearance: null,
      storage: "committed",
    },
  };
}

async function createRepository({ rows = [] } = {}) {
  const repository = await mkdtemp(join(tmpdir(), "finding-reconciliation-test-"));
  createdRepositories.push(repository);
  runGit(repository, "init", "-q");
  runGit(repository, "config", "user.name", "QA Test");
  runGit(repository, "config", "user.email", "qa@example.invalid");
  await writeFile(
    join(repository, "qa-context.md"),
    `# QA Context

## Project

- **Report output folder:** QA/

## Finding ledger

- **Path:** findings.jsonl
- **Repository visibility (\`repo_visibility\`):** private
- **Named components:** clock-grid, qa-driver
`,
  );
  await writeFile(
    join(repository, ".gitignore"),
    "QA/\nqa-reconciliation/**/.*\n*.finding-reconciliation.stage\nfindings.jsonl.lock*\n",
  );
  await writeFile(
    join(repository, "findings.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
  runGit(repository, "add", ".gitignore", "qa-context.md", "findings.jsonl");
  runGit(repository, "commit", "-qm", "test: initialize repository");
  return repository;
}

function sourceProposal(overrides = {}) {
  const proposal = {
    local_id: "bob-1",
    title: "Different catalogue sources duplicate one place",
    source_content_sha256: "",
    component: "clock-grid",
    location: "World clock grid",
    oracle: "One place appears once unless the user explicitly adds another clock.",
    severity: "S3",
    priority: "P1",
    sensitivity_classification: "standard",
    comparison: {
      storage: "sanitized",
      repro_steps: ["Open the grid.", "Inspect entries from both catalogues."],
      expected_result: "The place appears once.",
      actual_result: "The same place appears twice.",
      environment: "Synthetic browser fixture",
      safe_evidence_refs: ["evidence/grid-duplicate.png"],
    },
    ...structuredClone(overrides),
  };
  const digestInput = structuredClone(proposal);
  delete digestInput.source_content_sha256;
  proposal.source_content_sha256 = sha256(canonicalJson(digestInput));
  return proposal;
}

async function writeExecution(repository, {
  runId,
  executionId,
  lane,
  proposal,
  reportName,
  candidate,
}) {
  const reportPointer = `QA/${reportName}.md`;
  const sidecarPointer = `QA/${reportName}.proposals.json`;
  const reportSource = `# ${lane} report\n\nSynthetic immutable evidence.\n`;
  await mkdir(join(repository, "QA"), { recursive: true });
  await writeFile(join(repository, reportPointer), reportSource);
  const sidecar = {
    schema_version: 1,
    protocol: "qa-suite-finding-reconciliation",
    run_id: runId,
    execution_id: executionId,
    candidate: { kind: "git-commit", value: candidate },
    lane,
    report: { path: reportPointer, sha256: sha256(reportSource) },
    proposals: proposal ? [proposal] : [],
  };
  await writeFile(
    join(repository, sidecarPointer),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
  return {
    execution: {
      execution_id: executionId,
      lane,
      report_pointer: reportPointer,
      sidecar_pointer: sidecarPointer,
    },
    reportPointer,
    sidecar,
    sidecarPointer,
  };
}

async function prepareInventory(repository, executions, runId = "run-001") {
  const candidate = runGit(repository, "rev-parse", "HEAD");
  const written = [];
  for (const execution of executions) {
    written.push(await writeExecution(repository, {
      ...execution,
      runId,
      candidate,
    }));
  }
  const manifest = {
    schema_version: 1,
    protocol: "qa-suite-finding-reconciliation",
    run_id: runId,
    candidate: { kind: "git-commit", value: candidate },
    frozen_at: timestamp,
    selected_executions: written.map(({ execution }) => execution),
  };
  const dispatch = await freezeDispatchManifest({ repository, manifest });
  const inventory = await createProposalInventory({
    repository,
    dispatchPath: dispatch.path,
    createdAt: timestamp,
  });
  return { candidate, dispatch, inventory, manifest, written };
}

async function writeCandidateLedger(repository, rows, name = "candidate-findings.jsonl") {
  const path = `QA/${name}`;
  const source = rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length ? "\n" : "");
  await writeFile(join(repository, path), source);
  return { path, source, sha256: sha256(source) };
}

function proposalRef(report, proposal) {
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

async function writeDecisionEnvelope(repository, inventory, {
  decisions,
  candidateLedger = null,
  name = "run-decisions.json",
  supersedesRunId = null,
}) {
  const envelope = {
    schema_version: 1,
    protocol: "qa-suite-finding-reconciliation",
    run_id: inventory.inventory.run_id,
    supersedes_run_id: supersedesRunId,
    candidate: structuredClone(inventory.inventory.candidate),
    inventory: { path: inventory.path, sha256: inventory.digest },
    candidate_ledger: candidateLedger
      ? { path: candidateLedger.path, sha256: candidateLedger.sha256 }
      : null,
    reconciled_at: timestamp,
    decisions,
  };
  const path = `QA/${name}`;
  await writeFile(join(repository, path), canonicalJsonDocument(envelope));
  return { envelope, path };
}

function createdDecision(reference, stableFindingId, candidateFindingIds = []) {
  return {
    proposal: reference,
    disposition: "created",
    stable_finding_id: stableFindingId,
    candidate_finding_ids: candidateFindingIds,
    reason_code: "new-evidenced-finding",
    explanation: "The defect evidence establishes a distinct stable identity.",
    evidence_fields: [
      "component",
      "repro_steps",
      "expected_result",
      "actual_result",
      "environment",
      "candidate",
    ],
  };
}

function matchedDecision(reference, stableFindingId, candidateFindingIds) {
  return {
    proposal: reference,
    disposition: "matched",
    stable_finding_id: stableFindingId,
    candidate_finding_ids: candidateFindingIds,
    reason_code: "same-evidenced-defect",
    explanation: "Independent lane evidence proves the same defect identity.",
    evidence_fields: [
      "component",
      "repro_steps",
      "expected_result",
      "actual_result",
      "environment",
      "candidate",
    ],
  };
}

function rejectedDecision(reference, candidateFindingIds = []) {
  return {
    proposal: reference,
    disposition: "rejected",
    candidate_finding_ids: candidateFindingIds,
    reason_code: "tooling-or-environment-failure",
    explanation: "The observation came from the synthetic QA driver, not the product.",
    evidence_fields: ["component", "environment", "candidate"],
  };
}

function blockedDecision(reference, candidateFindingIds = []) {
  return {
    proposal: reference,
    disposition: "blocked",
    candidate_finding_ids: candidateFindingIds,
    reason_code: "sensitive-manual-handling",
    explanation: "Sensitive comparison content is withheld from durable reconciliation.",
    evidence_fields: ["component", "candidate"],
    unblock_condition: "An authorized human must review the ignored source proposal.",
  };
}

test.after(async () => {
  await Promise.all(createdRepositories.map((repository) =>
    rm(repository, { recursive: true, force: true }),
  ));
});

test("builds one canonical component-bounded semantic decision task", async () => {
  const matching = findingRow({
    id: "FND-clock-grid",
    candidate: "baseline",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-clock-grid.md",
    }],
  });
  const unrelated = findingRow({
    id: "FND-qa-driver",
    candidate: "baseline",
    component: "qa-driver",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-driver.md",
    }],
  });
  const repository = await createRepository({ rows: [matching, unrelated] });
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);

  const task = await buildSemanticDecisionTask({
    repository,
    inventoryPath: prepared.inventory.path,
    component: "clock-grid",
  });
  assert.equal(task.kind, "semantic-decision-task");
  assert.deepEqual(task.candidate_finding_ids, [matching.id]);
  assert.deepEqual(task.candidate_findings.map(({ id }) => id), [matching.id]);
  assert.equal(JSON.stringify(task).includes(unrelated.id), false);
  assert.equal(task.proposals.length, 1);
  assert.equal(task.proposals[0].identity.storage, "sanitized");
  assert.equal("title" in task.proposals[0].identity, false);
  assert.equal(task.proposals[0].required_decision, null);

  const script = fileURLToPath(
    new URL("../qa-suite/scripts/finding-reconciliation.mjs", import.meta.url),
  );
  const output = execFileSync(process.execPath, [
    script,
    "review",
    "--repo",
    repository,
    "--inventory",
    prepared.inventory.path,
    "--component",
    "clock-grid",
  ], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), task);
  assert.equal(output, canonicalJsonDocument(task));
});

test("semantic review withholds sensitive proposal identity and comparison", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "security-grid",
    lane: "security-qa",
    proposal: sourceProposal({
      sensitivity_classification: "security-s1-s2",
      comparison: {
        storage: "sensitive-local",
        repro_steps: ["Use an ignored sensitive fixture."],
        expected_result: "The protected behavior remains safe.",
        actual_result: "Sensitive local details are required for review.",
        environment: "Ignored local security fixture",
        local_evidence_refs: ["QA/private-evidence.txt"],
      },
    }),
    reportName: "run-001-security-grid",
  }]);

  const task = await buildSemanticDecisionTask({
    repository,
    inventoryPath: prepared.inventory.path,
    component: "clock-grid",
  });
  assert.deepEqual(task.proposals[0].identity, {
    storage: "withheld",
    location: null,
    oracle: null,
  });
  assert.deepEqual(task.proposals[0].comparison, {
    storage: "withheld",
    reason_code: "sensitive-manual-handling",
    safe_evidence_refs: [],
  });
  assert.equal(JSON.stringify(task).includes("private-evidence"), false);
  assert.deepEqual(task.proposals[0].required_decision, {
    disposition: "blocked",
    reason_code: "sensitive-manual-handling",
    explanation: "Sensitive comparison content is withheld from durable reconciliation.",
    unblock_condition: "An authorized human must review the ignored source proposal.",
    evidence_fields: ["component", "candidate"],
  });
});

test("rejects durable comparison storage for every non-standard sensitivity class", async () => {
  const cases = [
    { classification: "security-s1-s2", lane: "security-qa" },
    {
      classification: "uncertain",
      lane: `temporary-qa-risk-${"a".repeat(64)}`,
    },
    { classification: "human-sensitive", lane: "bob-qa" },
  ];
  for (const { classification, lane } of cases) {
    const repository = await createRepository();
    const marker = `private-${classification}-marker`;
    await assert.rejects(
      prepareInventory(repository, [{
        executionId: `unsafe-${classification}`,
        lane,
        proposal: sourceProposal({
          local_id: `unsafe-${classification}`,
          severity: classification === "security-s1-s2" ? "S2" : "S3",
          sensitivity_classification: classification,
          comparison: {
            storage: "sanitized",
            repro_steps: ["Open the synthetic fixture."],
            expected_result: "Sensitive details remain local.",
            actual_result: marker,
            environment: "Private synthetic fixture",
            safe_evidence_refs: [],
          },
        }),
        reportName: `unsafe-${classification}`,
      }], `run-unsafe-${classification}`),
      /sensitive classification.*sensitive-local comparison storage/,
    );
    assert.equal(await readFile(join(repository, "findings.jsonl"), "utf8"), "");
    await assert.rejects(
      readFile(join(
        repository,
        `qa-reconciliation/run-unsafe-${classification}/reconciliation-receipt.json`,
      )),
      { code: "ENOENT" },
    );
  }
});

test("blocks all non-standard sensitivity classes without materializing defect bytes", async () => {
  const cases = [
    { classification: "security-s1-s2", lane: "security-qa" },
    {
      classification: "uncertain",
      lane: `temporary-qa-risk-${"b".repeat(64)}`,
    },
    { classification: "human-sensitive", lane: "bob-qa" },
  ];
  for (const { classification, lane } of cases) {
    const repository = await createRepository();
    const marker = `private-${classification}-defect-marker`;
    const runId = `run-blocked-${classification}`;
    const prepared = await prepareInventory(repository, [{
      executionId: `blocked-${classification}`,
      lane,
      proposal: sourceProposal({
        local_id: `blocked-${classification}`,
        severity: classification === "security-s1-s2" ? "S2" : "S3",
        priority: classification === "security-s1-s2" ? "P0" : "P1",
        sensitivity_classification: classification,
        comparison: {
          storage: "sensitive-local",
          repro_steps: ["Inspect the ignored sensitive fixture."],
          expected_result: "Sensitive details remain local.",
          actual_result: marker,
          environment: "Private synthetic fixture",
          local_evidence_refs: [`QA/${marker}.png`],
        },
      }),
      reportName: `blocked-${classification}`,
    }], runId);
    const task = await buildSemanticDecisionTask({
      repository,
      inventoryPath: prepared.inventory.path,
      component: "clock-grid",
    });
    assert.deepEqual(task.proposals[0].required_decision, {
      disposition: "blocked",
      reason_code: "sensitive-manual-handling",
      explanation: "Sensitive comparison content is withheld from durable reconciliation.",
      unblock_condition: "An authorized human must review the ignored source proposal.",
      evidence_fields: ["component", "candidate"],
    });
    assert.equal(JSON.stringify(task).includes(marker), false);
    const report = prepared.inventory.inventory.reports[0];
    const draft = await writeDecisionEnvelope(repository, prepared.inventory, {
      decisions: [blockedDecision(proposalRef(report, report.proposals[0]))],
      name: `${runId}-draft.json`,
    });
    const candidatePath = `QA/${runId}-candidate.jsonl`;
    const materialized = await materializeCandidateLedger({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: draft.path,
      candidateLedgerPath: candidatePath,
      outputDecisionPath: `QA/${runId}-final.json`,
    });
    assert.equal(materialized.candidateLedgerPath, null);
    assert.equal(JSON.stringify(materialized.decision).includes(marker), false);
    await assert.rejects(readFile(join(repository, candidatePath)), { code: "ENOENT" });
    const reconciled = await reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: materialized.decisionPath,
    });
    assert.equal(reconciled.receipt.persistence.publication_state, "blocked-not-published");
    assert.equal(JSON.stringify(reconciled.receipt).includes(marker), false);
    assert.equal(await readFile(join(repository, "findings.jsonl"), "utf8"), "");
  }
});

test("materializes a full ledger without exposing unrelated components", async () => {
  const matching = findingRow({
    id: "FND-clock-grid",
    candidate: "baseline",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-clock-grid.md",
    }],
  });
  const unrelated = findingRow({
    id: "FND-qa-driver",
    candidate: "baseline",
    component: "qa-driver",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-driver.md",
    }],
  });
  const repository = await createRepository({ rows: [matching, unrelated] });
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const task = await buildSemanticDecisionTask({
    repository,
    inventoryPath: prepared.inventory.path,
    component: "clock-grid",
  });
  assert.equal(JSON.stringify(task).includes(unrelated.id), false);
  const report = prepared.inventory.inventory.reports[0];
  const proposal = report.proposals[0];
  const stableFindingId = "FND-catalogue-duplicate";
  const draft = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [createdDecision(
      proposalRef(report, proposal),
      stableFindingId,
      [matching.id],
    )],
    name: "run-001-draft-decisions.json",
  });
  const originalLedger = await readFile(join(repository, "findings.jsonl"), "utf8");
  const result = await materializeCandidateLedger({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: draft.path,
    candidateLedgerPath: "QA/run-001-candidate-findings.jsonl",
    outputDecisionPath: "QA/run-001-final-decisions.json",
  });
  const script = fileURLToPath(
    new URL("../qa-suite/scripts/finding-reconciliation.mjs", import.meta.url),
  );
  const cliResult = JSON.parse(execFileSync(process.execPath, [
    script,
    "materialize",
    "--repo",
    repository,
    "--inventory",
    prepared.inventory.path,
    "--decisions",
    draft.path,
    "--candidate-ledger",
    "QA/run-001-candidate-findings.jsonl",
    "--output",
    "QA/run-001-final-decisions.json",
  ], { encoding: "utf8" }));
  assert.deepEqual(cliResult, {
    decision_path: result.decisionPath,
    decision_sha256: result.decisionDigest,
    candidate_ledger_path: result.candidateLedgerPath,
    candidate_ledger_sha256: result.candidateLedgerDigest,
  });
  const candidateLedger = await readFile(
    join(repository, result.candidateLedgerPath),
    "utf8",
  );
  const originalUnrelatedLine = originalLedger
    .trimEnd()
    .split("\n")
    .find((line) => JSON.parse(line).id === unrelated.id);
  const candidateUnrelatedLine = candidateLedger
    .trimEnd()
    .split("\n")
    .find((line) => JSON.parse(line).id === unrelated.id);
  assert.equal(candidateUnrelatedLine, originalUnrelatedLine);
  assert.deepEqual(
    candidateLedger.trimEnd().split("\n").map(JSON.parse).map(({ id }) => id),
    [matching.id, unrelated.id, stableFindingId],
  );

  const reconciled = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: result.decisionPath,
  });
  assert.equal(reconciled.result, "published");
  assert.equal(
    (await verifyReconciliationPersistence({
      repository,
      receiptPath: reconciled.receiptPath,
    })).persistenceState,
    "pending-human-commit",
  );
});

test("materializes matched recurrence fields once per stable finding", async () => {
  const existing = findingRow({
    id: "FND-catalogue-duplicate",
    candidate: "baseline",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-duplicate.md",
    }],
  });
  existing.status = "fixed";
  existing.first_seen = "2026-08-05T18:00:00Z";
  existing.last_seen = "2026-08-05T18:00:00Z";
  const repository = await createRepository({ rows: [existing] });
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const proposal = report.proposals[0];
  const draft = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [matchedDecision(
      proposalRef(report, proposal),
      existing.id,
      [existing.id],
    )],
    name: "run-001-match-draft.json",
  });
  const result = await materializeCandidateLedger({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: draft.path,
    candidateLedgerPath: "QA/run-001-match-candidate.jsonl",
    outputDecisionPath: "QA/run-001-match-final.json",
  });
  const [candidate] = (await readFile(
    join(repository, result.candidateLedgerPath),
    "utf8",
  )).trimEnd().split("\n").map(JSON.parse);
  assert.equal(candidate.id, existing.id);
  assert.equal(candidate.status, "regressed");
  assert.equal(candidate.occurrences, existing.occurrences + 1);
  assert.equal(candidate.candidate_last_confirmed, prepared.candidate);
  assert.equal(candidate.last_seen, timestamp);
  assert.deepEqual(candidate.reports, [
    ...existing.reports,
    {
      candidate: prepared.candidate,
      lane: report.lane,
      pointer: report.report.path,
    },
  ]);
});

test("publishes a complete split decision idempotently and proves persistence", async () => {
  const baseline = findingRow({
    id: "FND-existing-actions",
    candidate: "baseline",
    reports: [{
      candidate: "baseline",
      lane: "bob-qa",
      pointer: "QA/baseline-actions.md",
    }],
  });
  const repository = await createRepository({ rows: [baseline] });
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const proposal = report.proposals[0];
  const newRow = findingRow({
    id: "FND-catalogue-duplicate",
    candidate: prepared.candidate,
    reports: [{
      candidate: prepared.candidate,
      lane: report.lane,
      pointer: report.report.path,
    }],
  });
  const candidateLedger = await writeCandidateLedger(
    repository,
    [baseline, newRow],
  );
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    candidateLedger,
    decisions: [createdDecision(
      proposalRef(report, proposal),
      newRow.id,
      [baseline.id],
    )],
  });

  const first = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: decisions.path,
  });
  assert.equal(first.result, "published");
  assert.equal(first.receipt.persistence.receipt_differs_from_head, true);
  assert.deepEqual(first.receipt.summary, {
    inventoried: 1,
    created: 1,
    matched: 0,
    rejected: 0,
    blocked: 0,
    unresolved: 0,
  });
  assert.deepEqual(first.receipt.finding_results[0].report_pointers, [report.report.path]);
  assert.equal(
    (await verifyReconciliationPersistence({
      repository,
      receiptPath: first.receiptPath,
    })).persistenceState,
    "pending-human-commit",
  );

  const retry = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: decisions.path,
  });
  assert.equal(retry.result, "existing");
  assert.equal(retry.receiptDigest, first.receiptDigest);

  runGit(repository, "add", "findings.jsonl", "qa-reconciliation");
  runGit(repository, "commit", "-qm", "test: persist reconciliation");
  const persistence = await verifyReconciliationPersistence({
    repository,
    receiptPath: first.receiptPath,
  });
  assert.equal(persistence.persistenceState, "durable-committed");
  const reconciliationCommit = runGit(repository, "rev-parse", "HEAD");
  assert.equal(persistence.durableCommit, reconciliationCommit);
  const cloneParent = await mkdtemp(join(tmpdir(), "finding-reconciliation-clone-"));
  createdRepositories.push(cloneParent);
  const clone = join(cloneParent, "fresh-clone");
  runGit(repository, "clone", "-q", repository, clone);
  const clonePersistence = await verifyReconciliationPersistence({
    repository: clone,
    receiptPath: first.receiptPath,
  });
  assert.equal(clonePersistence.persistenceState, "durable-committed");
  assert.equal(clonePersistence.durableCommit, reconciliationCommit);

  const laterRow = findingRow({
    id: "FND-later-change",
    candidate: "later-candidate",
    component: "qa-driver",
    reports: [{
      candidate: "later-candidate",
      lane: "bob-qa",
      pointer: "QA/later-change.md",
    }],
  });
  await writeFile(
    join(repository, "findings.jsonl"),
    [baseline, newRow, laterRow].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  runGit(repository, "add", "findings.jsonl");
  runGit(repository, "commit", "-qm", "test: advance ledger after reconciliation");
  const historical = await verifyReconciliationPersistence({
    repository,
    receiptPath: first.receiptPath,
  });
  assert.equal(historical.persistenceState, "durable-committed");
  assert.equal(historical.durableCommit, reconciliationCommit);
});

test("fails closed when one inventoried proposal has no decision", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [],
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decisions.path,
    }),
    /missing decisions for 1 inventoried proposal/,
  );
  assert.equal(await readFile(join(repository, "findings.jsonl"), "utf8"), "");
  await assert.rejects(
    access(join(repository, "qa-reconciliation/run-001/reconciliation-receipt.json")),
    /ENOENT/,
  );
});

test("merges cross-lane wording into one new identity with complete provenance", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [
    {
      executionId: "bob-grid",
      lane: "bob-qa",
      proposal: sourceProposal({ local_id: "bob-1" }),
      reportName: "run-001-bob-grid",
    },
    {
      executionId: "regression-grid",
      lane: "regression-qa",
      proposal: sourceProposal({
        local_id: "regression-1",
        title: "Catalogue merge repeats the same location",
      }),
      reportName: "run-001-regression-grid",
    },
  ]);
  const [bobReport, regressionReport] = prepared.inventory.inventory.reports;
  const row = findingRow({
    id: "FND-shared-identity",
    candidate: prepared.candidate,
    reports: [bobReport, regressionReport].map((report) => ({
      candidate: prepared.candidate,
      lane: report.lane,
      pointer: report.report.path,
    })),
  });
  const candidateLedger = await writeCandidateLedger(repository, [row]);
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    candidateLedger,
    decisions: [
      createdDecision(
        proposalRef(bobReport, bobReport.proposals[0]),
        row.id,
      ),
      matchedDecision(
        proposalRef(regressionReport, regressionReport.proposals[0]),
        row.id,
        [row.id],
      ),
    ],
  });
  const result = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: decisions.path,
  });
  assert.deepEqual(result.receipt.summary, {
    inventoried: 2,
    created: 1,
    matched: 1,
    rejected: 0,
    blocked: 0,
    unresolved: 0,
  });
  assert.deepEqual(
    result.receipt.finding_results[0].report_pointers,
    [bobReport.report.path, regressionReport.report.path],
  );
  assert.equal(result.receipt.finding_results[0].proposals.length, 2);
});

test("retains rejected S2/P0 tooling evidence prominently without changing rows", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-driver",
    lane: "bob-qa",
    proposal: sourceProposal({
      local_id: "bob-driver-1",
      component: "qa-driver",
      severity: "S2",
      priority: "P0",
    }),
    reportName: "run-001-bob-driver",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const reference = proposalRef(report, report.proposals[0]);
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [rejectedDecision(reference)],
  });
  const result = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: decisions.path,
  });
  assert.equal(result.receipt.summary.rejected, 1);
  assert.equal(result.receipt.prominent_risks.length, 1);
  assert.equal(result.receipt.prominent_risks[0].disposition, "rejected");
  assert.equal(result.receipt.ledger.sha256_before, result.receipt.ledger.sha256_after);
  assert.equal(result.receipt.persistence.ledger_differs_from_head, false);
  assert.equal(await readFile(join(repository, "findings.jsonl"), "utf8"), "");
});

test("recovers one dead-owner lock without allowing concurrent ownership", async () => {
  const repository = await createRepository();
  const lockPath = join(repository, "findings.jsonl.lock");
  const deadOwner = `${JSON.stringify({
    lock_version: 1,
    hostname: (await import("node:os")).hostname(),
    pid: 2_147_483_647,
    operation: "crashed-test",
  })}\n`;
  await writeFile(`${lockPath}.stale-recovery`, deadOwner);
  assert.equal(
    await withExclusiveLocks([lockPath], { operation: "orphan-claim" }, async () => "resumed"),
    "resumed",
  );
  await assert.rejects(access(`${lockPath}.stale-recovery`), { code: "ENOENT" });
  await writeFile(lockPath, deadOwner);
  let release;
  const held = new Promise((resolveHeld) => { release = resolveHeld; });
  let entered;
  const firstEntered = new Promise((resolveEntered) => { entered = resolveEntered; });
  const operation = async () => {
    entered();
    await held;
    return "owner";
  };
  const first = withExclusiveLocks([lockPath], { operation: "first" }, operation);
  await firstEntered;
  const second = withExclusiveLocks(
    [lockPath],
    { operation: "second" },
    async () => "unexpected-second-owner",
  );
  const secondResult = await second.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  release();
  assert.equal(await first, "owner");
  assert.equal(secondResult.status, "rejected");
  assert.match(secondResult.reason.message, /lock/);
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});

test("blocks a later run until the prior reconciliation is committed", async () => {
  const repository = await createRepository();
  const first = await prepareInventory(repository, [{
    executionId: "first-bob",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "first-bob",
  }], "run-first");
  const report = first.inventory.inventory.reports[0];
  const decision = await writeDecisionEnvelope(repository, first.inventory, {
    decisions: [rejectedDecision(proposalRef(report, report.proposals[0]))],
    name: "first-decisions.json",
  });
  await reconcileFindings({
    repository,
    inventoryPath: first.inventory.path,
    decisionPath: decision.path,
  });
  await assert.rejects(
    prepareInventory(repository, [{
      executionId: "second-bob",
      lane: "bob-qa",
      proposal: sourceProposal({ local_id: "bob-2" }),
      reportName: "second-bob",
    }], "run-second"),
    /prior run run-first must be committed/,
  );
  runGit(repository, "add", "findings.jsonl", "qa-reconciliation");
  runGit(repository, "commit", "-qm", "test: persist first run");
  await rm(join(repository, "qa-reconciliation/run-second"), {
    recursive: true,
    force: true,
  });
  const second = await prepareInventory(repository, [{
    executionId: "second-bob",
    lane: "bob-qa",
    proposal: sourceProposal({ local_id: "bob-2" }),
    reportName: "second-bob",
  }], "run-third");
  assert.equal(second.inventory.inventory.run_id, "run-third");
});

test("binds correction receipts to an existing durable superseded run", async () => {
  const repository = await createRepository();
  const first = await prepareInventory(repository, [{
    executionId: "correction-first",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "correction-first",
  }], "run-correction-first");
  const firstReport = first.inventory.inventory.reports[0];
  const firstDecision = await writeDecisionEnvelope(repository, first.inventory, {
    decisions: [rejectedDecision(proposalRef(firstReport, firstReport.proposals[0]))],
    name: "correction-first-decisions.json",
  });
  await reconcileFindings({
    repository,
    inventoryPath: first.inventory.path,
    decisionPath: firstDecision.path,
  });
  runGit(repository, "add", "findings.jsonl", "qa-reconciliation");
  runGit(repository, "commit", "-qm", "test: persist superseded run");

  const second = await prepareInventory(repository, [{
    executionId: "correction-second",
    lane: "bob-qa",
    proposal: sourceProposal({ local_id: "correction-2" }),
    reportName: "correction-second",
  }], "run-correction-second");
  const secondReport = second.inventory.inventory.reports[0];
  const selfDecision = await writeDecisionEnvelope(repository, second.inventory, {
    decisions: [rejectedDecision(proposalRef(secondReport, secondReport.proposals[0]))],
    name: "correction-self-decisions.json",
    supersedesRunId: "run-correction-second",
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: second.inventory.path,
      decisionPath: selfDecision.path,
    }),
    /cannot supersede itself/,
  );
  const correctionDecision = await writeDecisionEnvelope(repository, second.inventory, {
    decisions: [rejectedDecision(proposalRef(secondReport, secondReport.proposals[0]))],
    name: "correction-second-decisions.json",
    supersedesRunId: "run-correction-first",
  });
  const corrected = await reconcileFindings({
    repository,
    inventoryPath: second.inventory.path,
    decisionPath: correctionDecision.path,
  });
  assert.equal(corrected.receipt.supersedes_run_id, "run-correction-first");
  runGit(repository, "add", "findings.jsonl", "qa-reconciliation");
  runGit(repository, "commit", "-qm", "test: persist correction run");
  assert.equal((await verifyReconciliationPersistence({
    repository,
    receiptPath: corrected.receiptPath,
  })).persistenceState, "durable-committed");

  const driftedEnvelope = { ...correctionDecision.envelope, supersedes_run_id: null };
  await writeFile(
    join(repository, correctionDecision.path),
    canonicalJsonDocument(driftedEnvelope),
  );
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: second.inventory.path,
      decisionPath: correctionDecision.path,
    }),
    /existing reconciliation receipt conflicts with frozen inputs/,
  );
});

test("retains a complete blocked receipt without publishing a candidate ledger", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "security-private",
    lane: "security-qa",
    proposal: sourceProposal({
      severity: "S2",
      priority: "P0",
      sensitivity_classification: "human-sensitive",
      comparison: {
        storage: "sensitive-local",
        repro_steps: ["Inspect the private synthetic trace."],
        expected_result: "The trace remains private.",
        actual_result: "The trace requires authorized review.",
        environment: "Private synthetic fixture",
        local_evidence_refs: ["QA/private-trace.png"],
      },
    }),
    reportName: "run-001-security-private",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const unsafeBlocked = blockedDecision(proposalRef(report, report.proposals[0]));
  unsafeBlocked.explanation = "Copy private details into the durable receipt.";
  const unsafeDecisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [unsafeBlocked],
    name: "unsafe-sensitive-decisions.json",
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: unsafeDecisions.path,
    }),
    /fixed sensitive-manual-handling contract/,
  );
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [blockedDecision(proposalRef(report, report.proposals[0]))],
  });
  const result = await reconcileFindings({
    repository,
    inventoryPath: prepared.inventory.path,
    decisionPath: decisions.path,
  });
  assert.equal(result.receipt.persistence.publication_state, "blocked-not-published");
  assert.equal(result.receipt.summary.blocked, 1);
  assert.equal(result.receipt.ledger.sha256_after, null);
  assert.equal(result.receipt.prominent_risks[0].disposition, "blocked");
  assert.equal(await readFile(join(repository, "findings.jsonl"), "utf8"), "");
});

test("rejects blocked decisions mixed with identities that cannot be published", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "blocked-security",
    lane: "security-qa",
    proposal: sourceProposal({
      local_id: "security-1",
      sensitivity_classification: "human-sensitive",
      comparison: {
        storage: "sensitive-local",
        repro_steps: ["Inspect private evidence."],
        expected_result: "Private evidence remains local.",
        actual_result: "Human review is required.",
        environment: "Private fixture",
        local_evidence_refs: ["QA/private.png"],
      },
    }),
    reportName: "blocked-security",
  }, {
    executionId: "created-bob",
    lane: "bob-qa",
    proposal: sourceProposal({ local_id: "bob-created" }),
    reportName: "created-bob",
  }], "run-mixed-blocked");
  const [securityReport, bobReport] = prepared.inventory.inventory.reports;
  const row = findingRow({
    id: "FND-mixed-unpublished",
    candidate: prepared.candidate,
    reports: [{
      candidate: prepared.candidate,
      lane: bobReport.lane,
      pointer: bobReport.report.path,
    }],
  });
  const candidateLedger = await writeCandidateLedger(repository, [row]);
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    candidateLedger,
    decisions: [
      blockedDecision(proposalRef(securityReport, securityReport.proposals[0]), [row.id]),
      createdDecision(proposalRef(bobReport, bobReport.proposals[0]), row.id),
    ],
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decisions.path,
    }),
    /blocked decisions cannot coexist/,
  );
});

test("withholds sensitive comparison bytes while preserving dual digests", async () => {
  const repository = await createRepository();
  const sensitive = sourceProposal({
    title: "Private authentication failure",
    sensitivity_classification: "human-sensitive",
    comparison: {
      storage: "sensitive-local",
      repro_steps: ["Use password=synthetic-private-value."],
      expected_result: "Authentication remains private.",
      actual_result: "password=synthetic-private-value appeared in output.",
      environment: "Private synthetic fixture",
      local_evidence_refs: ["QA/private-auth.png"],
    },
  });
  const prepared = await prepareInventory(repository, [{
    executionId: "security-private",
    lane: "security-qa",
    proposal: sensitive,
    reportName: "run-001-security-private",
  }]);
  const durable = prepared.inventory.inventory.reports[0].proposals[0];
  assert.equal(durable.comparison.storage, "withheld");
  assert.equal(durable.comparison.reason_code, "sensitive-manual-handling");
  assert.notEqual(durable.source_content_sha256, durable.content_sha256);
  assert.doesNotMatch(prepared.inventory.source, /synthetic-private-value|private-auth\.png/);
});

test("detects report drift before freezing inventory", async () => {
  const repository = await createRepository();
  const candidate = runGit(repository, "rev-parse", "HEAD");
  const written = await writeExecution(repository, {
    runId: "run-drift",
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-drift-bob-grid",
    candidate,
  });
  const dispatch = await freezeDispatchManifest({
    repository,
    manifest: {
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: "run-drift",
      candidate: { kind: "git-commit", value: candidate },
      frozen_at: timestamp,
      selected_executions: [written.execution],
    },
  });
  await writeFile(join(repository, written.reportPointer), "changed report bytes\n");
  await assert.rejects(
    createProposalInventory({
      repository,
      dispatchPath: dispatch.path,
      createdAt: timestamp,
    }),
    /report identity drifted/,
  );
});

test("cannot classify completed proposal artifacts as unexecuted", async () => {
  const repository = await createRepository();
  const candidate = runGit(repository, "rev-parse", "HEAD");
  const written = await writeExecution(repository, {
    runId: "run-completed",
    executionId: "completed-bob",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "completed-bob",
    candidate,
  });
  const dispatch = await freezeDispatchManifest({
    repository,
    manifest: {
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: "run-completed",
      candidate: { kind: "git-commit", value: candidate },
      frozen_at: timestamp,
      selected_executions: [written.execution],
    },
  });
  await assert.rejects(
    createProposalInventory({
      repository,
      dispatchPath: dispatch.path,
      createdAt: timestamp,
      unexecuted: [{
        execution_id: "completed-bob",
        lane: "bob-qa",
        state: "blocked",
        reason_code: "claimed-missing-output",
        explanation: "The completed output must not be silently omitted.",
      }],
    }),
    /cannot be unexecuted because its completed report exists/,
  );
});

test("rejects sensitive classifications stored as durable comparison text", async () => {
  const repository = await createRepository();
  await assert.rejects(
    prepareInventory(repository, [{
      executionId: "unsafe-sensitive",
      lane: "security-qa",
      proposal: sourceProposal({
        sensitivity_classification: "human-sensitive",
      }),
      reportName: "unsafe-sensitive",
    }], "run-unsafe-sensitive"),
    /sensitive classification.*sensitive-local comparison storage/,
  );
});

test("requires a committed ledger and rejects symlinked artifact parents", async () => {
  const dirtyRepository = await createRepository();
  await writeFile(
    join(dirtyRepository, "findings.jsonl"),
    `${JSON.stringify(findingRow({
      id: "FND-uncommitted",
      candidate: "working-tree",
      reports: [{
        candidate: "working-tree",
        lane: "bob-qa",
        pointer: "QA/uncommitted.md",
      }],
    }))}\n`,
  );
  await assert.rejects(
    prepareInventory(dirtyRepository, [{
      executionId: "dirty-bob",
      lane: "bob-qa",
      proposal: sourceProposal(),
      reportName: "dirty-bob",
    }], "run-dirty-ledger"),
    /previous finding ledger to be committed in HEAD/,
  );

  const symlinkRepository = await createRepository();
  await mkdir(join(symlinkRepository, "artifact-store"));
  await symlink("artifact-store", join(symlinkRepository, "QA"));
  await assert.rejects(
    prepareInventory(symlinkRepository, [{
      executionId: "symlink-parent-bob",
      lane: "bob-qa",
      proposal: sourceProposal(),
      reportName: "symlink-parent-bob",
    }], "run-symlink-parent"),
    /path must not contain symlinks/,
  );
});

test("fails closed on third-digest recovery stages and persistence residue", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "recovery-bob",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "recovery-bob",
  }], "run-third-digest");
  const report = prepared.inventory.inventory.reports[0];
  const row = findingRow({
    id: "FND-third-digest",
    candidate: prepared.candidate,
    reports: [{
      candidate: prepared.candidate,
      lane: report.lane,
      pointer: report.report.path,
    }],
  });
  const candidateLedger = await writeCandidateLedger(repository, [row]);
  const decision = await writeDecisionEnvelope(repository, prepared.inventory, {
    candidateLedger,
    decisions: [createdDecision(proposalRef(report, report.proposals[0]), row.id)],
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decision.path,
      faultAfterPhase: "prepared",
    }),
    /injected failure after prepared/,
  );
  await writeFile(
    join(repository, "findings.jsonl.finding-reconciliation.stage"),
    "unexpected-third-digest\n",
  );
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decision.path,
    }),
    /unexpected third digest/,
  );

  const cleanRepository = await createRepository();
  const clean = await prepareInventory(cleanRepository, [{
    executionId: "residue-bob",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "residue-bob",
  }], "run-residue");
  const cleanReport = clean.inventory.inventory.reports[0];
  const cleanDecision = await writeDecisionEnvelope(cleanRepository, clean.inventory, {
    decisions: [rejectedDecision(proposalRef(cleanReport, cleanReport.proposals[0]))],
  });
  const result = await reconcileFindings({
    repository: cleanRepository,
    inventoryPath: clean.inventory.path,
    decisionPath: cleanDecision.path,
  });
  await writeFile(
    join(cleanRepository, "qa-reconciliation/run-residue/.transaction-journal.json"),
    "{}\n",
  );
  const persistence = await verifyReconciliationPersistence({
    repository: cleanRepository,
    receiptPath: result.receiptPath,
  });
  assert.equal(persistence.persistenceState, "blocked-recovery-required");
  assert.match(persistence.reason, /recovery residue remains/);
});

test("rejects duplicate report-local IDs even when proposal bodies differ", async () => {
  const repository = await createRepository();
  const candidate = runGit(repository, "rev-parse", "HEAD");
  const written = await writeExecution(repository, {
    runId: "run-duplicates",
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-duplicates-bob-grid",
    candidate,
  });
  written.sidecar.proposals.push(sourceProposal({
    local_id: "bob-1",
    title: "A different body with the same report-local identity",
  }));
  await writeFile(
    join(repository, written.sidecarPointer),
    `${JSON.stringify(written.sidecar, null, 2)}\n`,
  );
  const dispatch = await freezeDispatchManifest({
    repository,
    manifest: {
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: "run-duplicates",
      candidate: { kind: "git-commit", value: candidate },
      frozen_at: timestamp,
      selected_executions: [written.execution],
    },
  });
  await assert.rejects(
    createProposalInventory({
      repository,
      dispatchPath: dispatch.path,
      createdAt: timestamp,
    }),
    /proposal IDs contains duplicate bob-1/,
  );
});

test("detects report and proposal drift after inventory freeze", async () => {
  const repository = await createRepository();
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    decisions: [rejectedDecision(proposalRef(report, report.proposals[0]))],
  });
  await writeFile(join(repository, report.report.path), "drift after inventory\n");
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decisions.path,
    }),
    /report identity drifted/,
  );
});

test("rejects symlink substitution at immutable and candidate artifact paths", async () => {
  const repository = await createRepository();
  const candidate = runGit(repository, "rev-parse", "HEAD");
  const written = await writeExecution(repository, {
    runId: "run-symlink",
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-symlink-bob-grid",
    candidate,
  });
  await mkdir(join(repository, "qa-reconciliation/run-symlink"), { recursive: true });
  await writeFile(join(repository, "outside-dispatch.json"), "{}\n");
  await symlink(
    "../../outside-dispatch.json",
    join(repository, "qa-reconciliation/run-symlink/dispatch-manifest.json"),
  );
  await assert.rejects(
    freezeDispatchManifest({
      repository,
      manifest: {
        schema_version: 1,
        protocol: "qa-suite-finding-reconciliation",
        run_id: "run-symlink",
        candidate: { kind: "git-commit", value: candidate },
        frozen_at: timestamp,
        selected_executions: [written.execution],
      },
    }),
    /symlink/,
  );

  await rm(join(repository, "qa-reconciliation/run-symlink"), {
    recursive: true,
    force: true,
  });
  const prepared = await prepareInventory(repository, [{
    executionId: "bob-grid",
    lane: "bob-qa",
    proposal: sourceProposal(),
    reportName: "run-001-bob-grid",
  }]);
  const report = prepared.inventory.inventory.reports[0];
  const row = findingRow({
    id: "FND-symlink",
    candidate: prepared.candidate,
    reports: [{
      candidate: prepared.candidate,
      lane: report.lane,
      pointer: report.report.path,
    }],
  });
  const realCandidate = await writeCandidateLedger(
    repository,
    [row],
    "real-candidate.jsonl",
  );
  await symlink("real-candidate.jsonl", join(repository, "QA/symlink-candidate.jsonl"));
  const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
    candidateLedger: {
      path: "QA/symlink-candidate.jsonl",
      sha256: realCandidate.sha256,
    },
    decisions: [createdDecision(proposalRef(report, report.proposals[0]), row.id)],
  });
  await assert.rejects(
    reconcileFindings({
      repository,
      inventoryPath: prepared.inventory.path,
      decisionPath: decisions.path,
    }),
    /candidate ledger.*symlink/,
  );
});

test("recovers deterministically at every publication phase boundary", async (context) => {
  for (const phase of ["prepared", "ledger-published", "receipt-published"]) {
    await context.test(phase, async () => {
      const repository = await createRepository();
      const runId = `run-${phase}`;
      const prepared = await prepareInventory(repository, [{
        executionId: "bob-grid",
        lane: "bob-qa",
        proposal: sourceProposal(),
        reportName: `${runId}-bob-grid`,
      }], runId);
      const report = prepared.inventory.inventory.reports[0];
      const proposal = report.proposals[0];
      const row = findingRow({
        id: `FND-recovery-${phase}`,
        candidate: prepared.candidate,
        reports: [{
          candidate: prepared.candidate,
          lane: report.lane,
          pointer: report.report.path,
        }],
      });
      const candidateLedger = await writeCandidateLedger(
        repository,
        [row],
        `${runId}-candidate.jsonl`,
      );
      const decisions = await writeDecisionEnvelope(repository, prepared.inventory, {
        candidateLedger,
        decisions: [createdDecision(proposalRef(report, proposal), row.id)],
        name: `${runId}-decisions.json`,
      });
      await assert.rejects(
        reconcileFindings({
          repository,
          inventoryPath: prepared.inventory.path,
          decisionPath: decisions.path,
          faultAfterPhase: phase,
        }),
        new RegExp(`injected failure after ${phase}`),
      );
      if (phase === "receipt-published") {
        runGit(repository, "add", "findings.jsonl", "qa-reconciliation");
      }
      const recovered = await reconcileFindings({
        repository,
        inventoryPath: prepared.inventory.path,
        decisionPath: decisions.path,
      });
      assert.equal(recovered.recovered, true);
      assert.equal(recovered.ledgerDigest, candidateLedger.sha256);
      await assert.doesNotReject(
        access(join(repository, `qa-reconciliation/${runId}/reconciliation-receipt.json`)),
      );
      await assert.rejects(
        access(join(repository, `qa-reconciliation/${runId}/.transaction-journal.json`)),
        /ENOENT/,
      );
    });
  }
});
