import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildArtifacts,
  resolveCommit,
  verifyArtifactSet,
} from "../scripts/release/lib.mjs";
import {
  canonicalJson,
  canonicalJsonDocument,
  sha256,
} from "../qa-suite/scripts/lib/json-contract.mjs";
import { verifyInstalledPayload } from "../qa-suite/scripts/verify-installed-payload.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixedTimestamp = "2026-08-07T03:00:00Z";
const requiredProtocolPaths = [
  "SKILL.md",
  "assets/project-agent-smoke-qa.claude.md",
  "assets/project-agent-smoke-qa.codex.toml",
  "references/finding-proposals-v1.schema.json",
  "references/finding-reconciliation-dispatch-v1.schema.json",
  "references/finding-reconciliation-inventory-v1.schema.json",
  "references/finding-reconciliation-decisions-v1.schema.json",
  "references/finding-reconciliation-receipt-v1.schema.json",
  "references/finding-reconciliation.md",
  "scripts/finding-reconciliation.mjs",
  "scripts/lib/json-contract.mjs",
  "scripts/lib/repository-artifacts.mjs",
  "scripts/verify-installed-payload.mjs",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-08-07T03:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-07T03:00:00Z",
      ...options.env,
    },
  });
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).trim();
}

async function exportHostRoot(root, commit, name) {
  const destination = join(root, name);
  const archive = join(root, `${name}.tar`);
  await mkdir(destination);
  run("git", [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    commit,
    ".agents",
    ".claude",
    ".claude-plugin",
    ".codex-plugin",
    "qa-suite",
  ]);
  run("tar", ["-xf", archive, "-C", destination]);
  return destination;
}

async function createConsumerSeed(root) {
  const seed = join(root, "consumer-seed");
  await mkdir(seed);
  git(seed, "init", "-q");
  git(seed, "config", "user.name", "QA R4 Fixture");
  git(seed, "config", "user.email", "qa-r4@example.invalid");
  await writeFile(
    join(seed, "qa-context.md"),
    `# QA Context

## Project

- **Report output folder:** QA/

## Finding ledger

- **Path:** findings.jsonl
- **Repository visibility (\`repo_visibility\`):** private
- **Named components:** clock-grid
`,
  );
  await writeFile(
    join(seed, ".gitignore"),
    "QA/\nqa-reconciliation/**/.*\n*.finding-reconciliation.stage\nfindings.jsonl.lock*\n",
  );
  await writeFile(join(seed, "findings.jsonl"), "");
  git(seed, "add", ".gitignore", "qa-context.md", "findings.jsonl");
  git(seed, "commit", "-qm", "test: initialize reconciliation consumer");
  return seed;
}

function proposal() {
  const value = {
    local_id: "bob-1",
    title: "Duplicate catalogue entry",
    source_content_sha256: "",
    component: "clock-grid",
    location: "World clock grid",
    oracle: "One place appears once.",
    severity: "S3",
    priority: "P1",
    sensitivity_classification: "standard",
    comparison: {
      storage: "sanitized",
      repro_steps: ["Open the grid.", "Inspect both catalogue entries."],
      expected_result: "One place appears once.",
      actual_result: "The same place appears twice.",
      environment: "Synthetic browser fixture",
      safe_evidence_refs: ["evidence/grid.png"],
    },
  };
  const digestInput = structuredClone(value);
  delete digestInput.source_content_sha256;
  value.source_content_sha256 = sha256(canonicalJson(digestInput));
  return value;
}

async function writeFrozenLaneOutput(repository, runId) {
  const candidate = git(repository, "rev-parse", "HEAD");
  const reportPath = "QA/2026-08-07-0300-bob-qa-host-parity.md";
  const sidecarPath = `${reportPath.slice(0, -3)}.proposals.json`;
  const report = "# Go with findings — Bob QA: host parity\n\nSynthetic immutable evidence.\n";
  const executionId = "bob-host-parity";
  await mkdir(join(repository, "QA"), { recursive: true });
  await writeFile(join(repository, reportPath), report);
  await writeFile(
    join(repository, sidecarPath),
    canonicalJsonDocument({
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: runId,
      execution_id: executionId,
      candidate: { kind: "git-commit", value: candidate },
      lane: "bob-qa",
      report: { path: reportPath, sha256: sha256(report) },
      proposals: [proposal()],
    }),
  );
  const dispatchInput = "QA/dispatch-input.json";
  await writeFile(
    join(repository, dispatchInput),
    canonicalJsonDocument({
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: runId,
      candidate: { kind: "git-commit", value: candidate },
      frozen_at: fixedTimestamp,
      selected_executions: [{
        execution_id: executionId,
        lane: "bob-qa",
        report_pointer: reportPath,
        sidecar_pointer: sidecarPath,
      }],
    }),
  );
  return { candidate, dispatchInput };
}

function helperOutput(helper, repository, command, args) {
  return run(process.execPath, [
    realpathSync(helper),
    command,
    "--repo",
    repository,
    ...args,
  ], { cwd: repository });
}

async function executeHostSequence({
  repository,
  firstHelper,
  secondHelper,
  runId,
}) {
  const { candidate, dispatchInput } = await writeFrozenLaneOutput(repository, runId);
  const dispatch = JSON.parse(helperOutput(
    firstHelper,
    repository,
    "dispatch",
    ["--input", dispatchInput],
  ));
  const inventoryResult = JSON.parse(helperOutput(
    firstHelper,
    repository,
    "inventory",
    ["--dispatch", dispatch.path, "--created-at", fixedTimestamp],
  ));
  const reviewBytes = helperOutput(
    firstHelper,
    repository,
    "review",
    ["--inventory", inventoryResult.path, "--component", "clock-grid"],
  );
  assert.equal(
    reviewBytes,
    canonicalJsonDocument(JSON.parse(reviewBytes)),
  );
  const inventory = JSON.parse(await readFile(
    join(repository, inventoryResult.path),
    "utf8",
  ));
  const report = inventory.reports[0];
  const proposalEntry = report.proposals[0];
  const proposalIdentity = {
    execution_id: report.execution_id,
    lane: report.lane,
    report_pointer: report.report.path,
    report_sha256: report.report.sha256,
    local_id: proposalEntry.local_id,
    source_content_sha256: proposalEntry.source_content_sha256,
    content_sha256: proposalEntry.content_sha256,
  };
  const draftPath = "QA/host-parity-draft.json";
  await writeFile(
    join(repository, draftPath),
    canonicalJsonDocument({
      schema_version: 1,
      protocol: "qa-suite-finding-reconciliation",
      run_id: runId,
      supersedes_run_id: null,
      candidate: { kind: "git-commit", value: candidate },
      inventory: {
        path: inventoryResult.path,
        sha256: inventoryResult.sha256,
      },
      candidate_ledger: null,
      reconciled_at: fixedTimestamp,
      decisions: [{
        proposal: proposalIdentity,
        disposition: "created",
        stable_finding_id: "FND-host-payload-parity",
        candidate_finding_ids: [],
        reason_code: "new-evidenced-finding",
        explanation: "The evidence establishes a distinct stable finding.",
        evidence_fields: [
          "component",
          "repro_steps",
          "expected_result",
          "actual_result",
          "environment",
          "candidate",
        ],
      }],
    }),
  );
  const candidatePath = "QA/host-parity-candidate.jsonl";
  const finalPath = "QA/host-parity-final.json";
  const materialized = JSON.parse(helperOutput(
    secondHelper,
    repository,
    "materialize",
    [
      "--inventory", inventoryResult.path,
      "--decisions", draftPath,
      "--candidate-ledger", candidatePath,
      "--output", finalPath,
    ],
  ));
  const repeated = JSON.parse(helperOutput(
    firstHelper,
    repository,
    "materialize",
    [
      "--inventory", inventoryResult.path,
      "--decisions", draftPath,
      "--candidate-ledger", candidatePath,
      "--output", finalPath,
    ],
  ));
  assert.deepEqual(repeated, materialized);
  const reconciliation = JSON.parse(helperOutput(
    firstHelper,
    repository,
    "reconcile",
    ["--inventory", inventoryResult.path, "--decisions", finalPath],
  ));
  const verification = JSON.parse(helperOutput(
    secondHelper,
    repository,
    "verify",
    ["--receipt", reconciliation.path],
  ));
  assert.equal(verification.persistenceState, "pending-human-commit");
  return {
    candidateBytes: await readFile(join(repository, candidatePath), "utf8"),
    decisionBytes: await readFile(join(repository, finalPath), "utf8"),
    inventoryBytes: await readFile(join(repository, inventoryResult.path), "utf8"),
    ledgerBytes: await readFile(join(repository, "findings.jsonl"), "utf8"),
    receiptBytes: await readFile(join(repository, reconciliation.path), "utf8"),
    receiptPath: reconciliation.path,
    reviewBytes,
    verification,
  };
}

test("R4 proof corpus enumerates all required adversarial and control cases", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("./fixtures/finding-reconciliation-r4-proof.json", import.meta.url),
    "utf8",
  ));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.protocol, "qa-suite-finding-reconciliation");
  assert.deepEqual(
    manifest.cases.map(({ requirement }) => requirement),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  assert.equal(new Set(manifest.cases.map(({ id }) => id)).size, 12);
  assert.ok(manifest.cases.some(({ role }) => role === "adversarial"));
  assert.ok(manifest.cases.some(({ role }) => role === "control"));
  for (const proof of manifest.cases) {
    assert.deepEqual(
      Object.keys(proof).sort(),
      ["expected", "id", "proof_file", "proof_test", "requirement", "role"],
    );
    assert.ok(["adversarial", "control"].includes(proof.role));
    const source = await readFile(join(repositoryRoot, proof.proof_file), "utf8");
    assert.ok(
      source.includes(`test("${proof.proof_test}"`),
      `${proof.id} proof test is missing`,
    );
  }
});

test("proves exact-ref payload parity across isolated Codex and Claude roots", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "qa-suite-r4-release-proof-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  await mkdir(artifacts);
  const commit = resolveCommit("HEAD");
  const built = await buildArtifacts(commit, artifacts);
  const verified = await verifyArtifactSet(commit, artifacts);
  const skillArchive = join(artifacts, "qa-suite.skill");
  const sourceArchive = join(artifacts, "qa-suite-source.zip");
  assert.deepEqual(await readFile(skillArchive), await readFile(sourceArchive));
  assert.equal(built.commit, commit);
  assert.equal(verified.commit, commit);
  assert.equal(built.digest, verified.digest);
  const evidence = JSON.parse(await readFile(
    join(artifacts, "build-evidence.json"),
    "utf8",
  ));
  assert.equal(evidence.commit, commit);
  assert.deepEqual(
    new Set(evidence.assets.map(({ sha256: digest }) => digest)),
    new Set([verified.digest]),
  );

  const [codexRoot, claudeRoot] = await Promise.all([
    exportHostRoot(root, commit, "codex-install"),
    exportHostRoot(root, commit, "claude-install"),
  ]);
  for (const hostRoot of [codexRoot, claudeRoot]) {
    for (const archive of [skillArchive, sourceArchive]) {
      const report = await verifyInstalledPayload({
        archive,
        installedRoot: join(hostRoot, "qa-suite"),
      });
      assert.equal(report.result, "match");
      assert.equal(report.archive_sha256, verified.digest);
      assert.equal(report.expected_entries, report.observed_entries);
      assert.deepEqual(report.differences, []);
    }
    await Promise.all(requiredProtocolPaths.map((path) =>
      access(join(hostRoot, "qa-suite", path)),
    ));
  }

  const codexManifest = JSON.parse(await readFile(
    join(codexRoot, ".codex-plugin/plugin.json"),
    "utf8",
  ));
  const claudeManifest = JSON.parse(await readFile(
    join(claudeRoot, ".claude-plugin/plugin.json"),
    "utf8",
  ));
  assert.equal(codexManifest.skills, "./qa-suite/");
  assert.equal(claudeManifest.skills, "./qa-suite");
  assert.equal(claudeManifest.agents.length, 11);
  assert.equal(
    (await readdir(join(claudeRoot, ".claude/commands")))
      .filter((name) => name.endsWith(".md")).length,
    3,
  );
  assert.equal(
    (await readdir(join(claudeRoot, ".claude/agents")))
      .filter((name) => name.endsWith(".md")).length,
    11,
  );
  assert.equal(
    (await readdir(join(codexRoot, "qa-suite/references/agents")))
      .filter((name) => name.endsWith(".md")).length,
    10,
  );

  const driftRoot = join(root, "drift-install", "qa-suite");
  await cp(join(codexRoot, "qa-suite"), driftRoot, { recursive: true });
  const driftPath = join(driftRoot, "scripts/finding-reconciliation.mjs");
  await writeFile(driftPath, `${await readFile(driftPath, "utf8")}\n`);
  const drift = await verifyInstalledPayload({
    archive: sourceArchive,
    installedRoot: driftRoot,
  });
  assert.equal(drift.result, "mismatch");
  assert.deepEqual(
    drift.differences.map(({ path, difference }) => ({ path, difference })),
    [{ path: "scripts/finding-reconciliation.mjs", difference: "content" }],
  );
});

test("resumes frozen reconciliation across separate installed host processes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "qa-suite-r4-host-proof-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const commit = resolveCommit("HEAD");
  const [codexRoot, claudeRoot] = await Promise.all([
    exportHostRoot(root, commit, "codex-process"),
    exportHostRoot(root, commit, "claude-process"),
  ]);
  const codexHelper = join(codexRoot, "qa-suite/scripts/finding-reconciliation.mjs");
  const claudeHelper = join(claudeRoot, "qa-suite/scripts/finding-reconciliation.mjs");
  const seed = await createConsumerSeed(root);
  const codexFirst = join(root, "consumer-codex-first");
  const claudeFirst = join(root, "consumer-claude-first");
  git(root, "clone", "-q", seed, codexFirst);
  git(root, "clone", "-q", seed, claudeFirst);
  const [first, second] = await Promise.all([
    executeHostSequence({
      repository: codexFirst,
      firstHelper: codexHelper,
      secondHelper: claudeHelper,
      runId: "run-host-payload-parity",
    }),
    executeHostSequence({
      repository: claudeFirst,
      firstHelper: claudeHelper,
      secondHelper: codexHelper,
      runId: "run-host-payload-parity",
    }),
  ]);
  for (const field of [
    "reviewBytes",
    "inventoryBytes",
    "candidateBytes",
    "decisionBytes",
    "ledgerBytes",
    "receiptBytes",
  ]) {
    assert.equal(first[field], second[field], field);
  }
  assert.deepEqual(first.verification, second.verification);

  git(codexFirst, "config", "user.name", "QA R4 Fixture");
  git(codexFirst, "config", "user.email", "qa-r4@example.invalid");
  git(codexFirst, "add", "findings.jsonl", "qa-reconciliation");
  git(codexFirst, "commit", "-qm", "test: persist reconciliation proof");
  const freshClone = join(root, "consumer-fresh-clone");
  git(root, "clone", "-q", codexFirst, freshClone);
  const durable = JSON.parse(helperOutput(
    claudeHelper,
    freshClone,
    "verify",
    ["--receipt", first.receiptPath],
  ));
  assert.equal(durable.persistenceState, "durable-committed");
});
