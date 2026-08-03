import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { test } from "node:test";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  canonicalJson,
  parseContractJson,
  sha256,
  validateClosedCaseRun,
  validateFixtureManifest,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";
import { previewSuite } from "../scripts/evaluation/scoring.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const subjectCommit = "0123456789abcdef0123456789abcdef01234567";

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

function fixtureRoot(caseId) {
  return join(repositoryRoot, "tests/evaluation/fixtures", caseId);
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`unsupported fixture entry ${path}`);
    }
  }
  return files.sort();
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function pairRoles(oracles) {
  const adversarial = oracles.find(({ role }) => role === "adversarial");
  const control = oracles.find(({ role }) => role === "control");
  assert.ok(adversarial);
  assert.ok(control);
  return { adversarial, control };
}

function oracleTokens(oracles) {
  return oracles.flatMap((oracle) => [
    oracle.pair_id,
    oracle.canary_token,
    oracle.role === "adversarial"
      ? oracle.assertions.expected_defects[0].id
      : oracle.assertions.control_budget.id,
  ]);
}

async function loadCorpus(definition) {
  const suite = await readContract(
    `tests/evaluation/suites/${definition.file}`,
    `${definition.lane} suite`,
  );
  const oracles = await readContract(
    `tests/evaluation/oracles/${definition.file}`,
    `${definition.lane} oracle set`,
  );
  return {
    ...definition,
    oracles,
    roles: pairRoles(oracles),
    suite,
  };
}

const corpora = await Promise.all([
  loadCorpus({
    criterion: "REL-01",
    evidence: [
      {
        kind: "log",
        path: "QA/evidence/dispatch-recovery.log",
      },
      {
        kind: "measurement",
        path: "QA/evidence/dispatch-recovery.json",
      },
    ],
    file: "reliability-evaluation-v1.json",
    findingId: "REL-01-FINDING",
    flowId: "flow_dispatch_summary_recovery",
    happySuite: "public/recovery-suite.mjs",
    lane: "reliability-qa",
    severity: "S2",
    surfaceId: "surface_dispatch_summary",
  }),
  loadCorpus({
    criterion: "DEPLOY-01",
    evidence: [
      {
        kind: "measurement",
        path: "QA/evidence/release-slot-rollout.json",
      },
    ],
    file: "deployment-evaluation-v1.json",
    findingId: "DEPLOY-01-FINDING",
    flowId: "flow_failed_rollout_rollback",
    happySuite: "public/deployment-suite.mjs",
    lane: "deployment-qa",
    severity: "S2",
    surfaceId: "surface_release_slot",
  }),
  loadCorpus({
    criterion: "DATA-01",
    evidence: [
      {
        kind: "measurement",
        path: "QA/evidence/interrupted-transfer.json",
      },
    ],
    file: "data-integrity-evaluation-v1.json",
    findingId: "DATA-01-FINDING",
    flowId: "flow_acknowledged_transfer",
    happySuite: "public/transaction-suite.mjs",
    lane: "data-integrity-qa",
    severity: "S1",
    surfaceId: "surface_acknowledged_transfer",
  }),
]);

const corpusByLane = new Map(
  corpora.map((corpus) => [corpus.lane, corpus]),
);

async function normalizedContexts(corpus) {
  return Promise.all(
    [corpus.roles.adversarial, corpus.roles.control].map(async (oracle) =>
      (await readFile(
        join(fixtureRoot(oracle.case_id), "qa-context.md"),
        "utf8",
      )).replaceAll(oracle.case_id, "fx_selected")
    ),
  );
}

async function assertSharedFiles(corpus, paths) {
  const adversarialRoot = fixtureRoot(corpus.roles.adversarial.case_id);
  const controlRoot = fixtureRoot(corpus.roles.control.case_id);
  for (const path of paths) {
    assert.equal(
      await readFile(join(adversarialRoot, path), "utf8"),
      await readFile(join(controlRoot, path), "utf8"),
      `${corpus.lane} shared file ${path} drifted`,
    );
  }
  const contexts = await normalizedContexts(corpus);
  assert.equal(contexts[0], contexts[1]);
}

test("operational pair declarations seal exact role-neutral fixture bytes", async () => {
  const allCaseIds = corpora.flatMap(({ suite }) =>
    suite.cases.map(({ id }) => id)
  );
  const allTokens = corpora.flatMap(({ oracles }) => oracleTokens(oracles));

  for (const corpus of corpora) {
    assert.equal(validateSuite(corpus.suite), corpus.suite);
    assert.equal(
      validateOracleSet(corpus.oracles, corpus.suite),
      corpus.oracles,
    );
    assert.equal(
      corpus.suite.cases.some((suiteCase) =>
        Object.hasOwn(suiteCase, "report_identifiers")
      ),
      false,
    );

    for (const suiteCase of corpus.suite.cases) {
      const manifest = await readContract(
        suiteCase.fixture_manifest,
        `${suiteCase.id} manifest`,
      );
      assert.equal(validateFixtureManifest(manifest, suiteCase), manifest);
      const actualPaths = [
        ...await collectFiles(join(fixtureRoot(suiteCase.id), "public")),
        join(repositoryRoot, suiteCase.qa_context),
      ].map(repositoryPath).sort();
      assert.deepEqual(
        manifest.files.map(({ path }) => path),
        actualPaths,
      );

      let selectedBytes = "";
      for (const declaration of manifest.files) {
        const path = join(repositoryRoot, declaration.path);
        const metadata = await lstat(path);
        const bytes = await readFile(path);
        assert.equal(metadata.isFile(), true);
        assert.equal(metadata.isSymbolicLink(), false);
        assert.equal(
          (metadata.mode & 0o111) === 0 ? "100644" : "100755",
          declaration.mode,
        );
        assert.equal(sha256(bytes), declaration.sha256);
        if (declaration.path.endsWith("/public/findings.jsonl")) {
          assert.equal(bytes.length, 0);
        }
        selectedBytes += bytes.toString("utf8");
      }

      for (const token of allTokens) {
        assert.equal(selectedBytes.includes(token), false);
      }
      for (const otherCaseId of allCaseIds) {
        if (otherCaseId !== suiteCase.id) {
          assert.equal(selectedBytes.includes(otherCaseId), false);
        }
      }
      for (const forbidden of [
        /\badversarial\b/iu,
        /(?<!-)\bcontrol\b/iu,
        /\bexpected[_ -]?defect\b/iu,
        /\boracle\b/iu,
        /\bpair[_ -]?id\b/iu,
        /seal_[0-9a-f]{64}/u,
      ]) {
        assert.equal(forbidden.test(selectedBytes), false);
      }
      for (const secretShape of [
        /-----BEGIN [A-Z ]+ PRIVATE KEY-----/u,
        /\bapi[_-]?key\s*[:=]/iu,
        /\bpassword\s*[:=]/iu,
      ]) {
        assert.equal(secretShape.test(selectedBytes), false);
      }
    }
  }
});

test("both sides of every operational pair pass their ordinary path", () => {
  for (const corpus of corpora) {
    for (const suiteCase of corpus.suite.cases) {
      const result = spawnSync(
        process.execPath,
        ["--test", join(fixtureRoot(suiteCase.id), corpus.happySuite)],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: process.env,
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
  }
});

test("reliability pair differs only in post-restoration recovery", async () => {
  const corpus = corpusByLane.get("reliability-qa");
  assert.ok(corpus);
  await assertSharedFiles(corpus, [
    "public/findings.jsonl",
    "public/recovery-suite.mjs",
    "public/reliability-contract.md",
  ]);

  const adversarialRoot = fixtureRoot(corpus.roles.adversarial.case_id);
  const controlRoot = fixtureRoot(corpus.roles.control.case_id);
  const adversarialSource = await readFile(
    join(adversarialRoot, "public/recovery-scenario.mjs"),
    "utf8",
  );
  const controlSource = await readFile(
    join(controlRoot, "public/recovery-scenario.mjs"),
    "utf8",
  );
  assert.equal(
    controlSource.replace(
      "const resumesAfterRestoration = true;",
      "const resumesAfterRestoration = false;",
    ),
    adversarialSource,
  );
  assert.equal(
    (controlSource.match(/const resumesAfterRestoration = true;/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (adversarialSource.match(/const resumesAfterRestoration = false;/gu) ?? [])
      .length,
    1,
  );

  const adversarialModule = await import(
    pathToFileURL(join(adversarialRoot, "public/recovery-scenario.mjs")).href
  );
  const controlModule = await import(
    pathToFileURL(join(controlRoot, "public/recovery-scenario.mjs")).href
  );
  assert.deepEqual(
    adversarialModule.runHealthyOperation(),
    controlModule.runHealthyOperation(),
  );

  const adversarial = adversarialModule.runDependencyRecoveryScenario();
  const control = controlModule.runDependencyRecoveryScenario();
  assert.deepEqual(adversarial.timeline.slice(0, 5), control.timeline.slice(0, 5));
  assert.equal(adversarial.retries, 2);
  assert.equal(control.retries, 2);
  assert.equal(adversarial.retry_limit, 2);
  assert.equal(control.retry_limit, 2);
  assert.equal(adversarial.dependency_restored_at_ms, 50);
  assert.equal(control.dependency_restored_at_ms, 50);
  assert.equal(control.dispatch_summary_available, true);
  assert.equal(control.recovery_at_ms, 70);
  assert.equal(control.elapsed_after_restoration_ms, 20);
  assert.equal(control.recovery_objective_met, true);
  assert.equal(control.alert_state, "resolved");
  assert.equal(adversarial.dispatch_summary_available, false);
  assert.equal(adversarial.recovery_at_ms, null);
  assert.equal(adversarial.elapsed_after_restoration_ms, 110);
  assert.equal(adversarial.recovery_objective_met, false);
  assert.equal(adversarial.alert_state, "firing");
});

test("deployment pair differs only in rollback snapshot timing", async () => {
  const corpus = corpusByLane.get("deployment-qa");
  assert.ok(corpus);
  await assertSharedFiles(corpus, [
    "public/artifacts/service-v1.json",
    "public/artifacts/service-v2.json",
    "public/config/service-v1.json",
    "public/config/service-v2.json",
    "public/deployment-contract.md",
    "public/deployment-suite.mjs",
    "public/findings.jsonl",
  ]);

  const adversarialRoot = fixtureRoot(corpus.roles.adversarial.case_id);
  const controlRoot = fixtureRoot(corpus.roles.control.case_id);
  const adversarialSource = await readFile(
    join(adversarialRoot, "public/rollout.mjs"),
    "utf8",
  );
  const controlSource = await readFile(
    join(controlRoot, "public/rollout.mjs"),
    "utf8",
  );
  assert.equal(
    controlSource.replace(
      'const rollbackSnapshotPhase = "before";',
      'const rollbackSnapshotPhase = "after";',
    ),
    adversarialSource,
  );

  const adversarialModule = await import(
    pathToFileURL(join(adversarialRoot, "public/rollout.mjs")).href
  );
  const controlModule = await import(
    pathToFileURL(join(controlRoot, "public/rollout.mjs")).href
  );
  assert.deepEqual(
    await adversarialModule.runPreflight(),
    await controlModule.runPreflight(),
  );

  const adversarial = await adversarialModule.rehearseRollout();
  const control = await controlModule.rehearseRollout();
  assert.deepEqual(adversarial.pre_rollout, control.pre_rollout);
  assert.deepEqual(adversarial.candidate, control.candidate);
  assert.equal(adversarial.pre_rollout.health_ready, true);
  assert.equal(control.pre_rollout.health_ready, true);
  assert.equal(adversarial.candidate_verification, "failed");
  assert.equal(control.candidate_verification, "failed");
  assert.equal(adversarial.candidate.health_ready, false);
  assert.equal(control.candidate.health_ready, false);
  assert.deepEqual(adversarial.after_rollback, adversarial.candidate);
  assert.equal(adversarial.rollback_succeeded, false);
  assert.deepEqual(control.after_rollback, control.pre_rollout);
  assert.equal(control.rollback_succeeded, true);
});

test("data-integrity pair differs only in interrupted-write recovery", async () => {
  const corpus = corpusByLane.get("data-integrity-qa");
  assert.ok(corpus);
  await assertSharedFiles(corpus, [
    "public/data-contract.json",
    "public/findings.jsonl",
    "public/probe.mjs",
    "public/transaction-suite.mjs",
  ]);

  const adversarialRoot = fixtureRoot(corpus.roles.adversarial.case_id);
  const controlRoot = fixtureRoot(corpus.roles.control.case_id);
  const adversarialSource = await readFile(
    join(adversarialRoot, "public/transfer-store.mjs"),
    "utf8",
  );
  const controlSource = await readFile(
    join(controlRoot, "public/transfer-store.mjs"),
    "utf8",
  );
  assert.equal(
    controlSource.replace(
      "const recoverInterruptedWrite = true;",
      "const recoverInterruptedWrite = false;",
    ),
    adversarialSource,
  );

  const adversarialModule = await import(
    pathToFileURL(join(adversarialRoot, "public/transfer-store.mjs")).href
  );
  const controlModule = await import(
    pathToFileURL(join(controlRoot, "public/transfer-store.mjs")).href
  );
  const adversarialNormal = adversarialModule.runAcknowledgedTransfer();
  const controlNormal = controlModule.runAcknowledgedTransfer();
  assert.deepEqual(adversarialNormal, controlNormal);
  assert.equal(adversarialNormal.state_matches_acknowledged_write, true);

  const adversarial = adversarialModule.runAcknowledgedTransfer({
    interruptAfterDebit: true,
  });
  const control = controlModule.runAcknowledgedTransfer({
    interruptAfterDebit: true,
  });
  assert.equal(adversarial.acknowledged, true);
  assert.equal(control.acknowledged, true);
  assert.equal(adversarial.interruption_point, "after-debit-before-credit");
  assert.equal(control.interruption_point, "after-debit-before-credit");
  assert.deepEqual(adversarial.before, control.before);
  assert.deepEqual(adversarial.expected, control.expected);
  assert.deepEqual(control.after, control.expected);
  assert.equal(control.state_matches_acknowledged_write, true);
  assert.equal(control.after.record_count, 2);
  assert.equal(control.after.invariant.actual, 100);
  assert.equal(control.after.invariant.holds, true);
  assert.equal(adversarial.after.record_count, 2);
  assert.equal(adversarial.after.invariant.actual, 90);
  assert.equal(adversarial.after.invariant.holds, false);
  assert.notEqual(
    adversarial.after.digest_sha256,
    adversarial.expected.digest_sha256,
  );
  assert.equal(adversarial.state_matches_acknowledged_write, false);

  const contract = await readContract(
    repositoryPath(join(controlRoot, "public/data-contract.json")),
    "data contract",
  );
  assert.equal(
    contract.acknowledged_state.digest_sha256,
    control.expected.digest_sha256,
  );
});

function smokeGate(suiteCase) {
  return {
    blocking_evidence: [],
    checklist: suiteCase.smoke_checks.map((id) => ({
      evidence: [],
      id,
      state: "Pass",
    })),
    findings: [],
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: null,
      state: "Go",
    },
  };
}

function specialistResult(corpus, oracle, priority) {
  const findings = oracle.role === "adversarial"
    ? [
        {
          classification: "governed",
          criteria: [corpus.criterion],
          evidence: corpus.evidence,
          id: corpus.findingId,
          priority,
          severity: corpus.severity,
          surface_id: corpus.surfaceId,
        },
      ]
    : [];
  const flow = {
    core: true,
    effectiveness: oracle.role === "control",
    evidence: corpus.evidence,
    finding_ids: findings.map(({ id }) => id),
    id: corpus.flowId,
    state: oracle.role === "control" ? "Pass" : "Fail",
  };
  const severityCounts = {
    S1: 0,
    S2: 0,
    S3: 0,
    S4: 0,
  };
  for (const finding of findings) {
    severityCounts[finding.severity] += 1;
  }
  return {
    blocking_evidence: [],
    checklist: [],
    findings,
    flows: [flow],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: severityCounts,
      state: findings.length === 0 ? "Go" : "No-Go",
    },
  };
}

function normalizedCase(corpus, oracle, priority = "P1") {
  const suiteCase = corpus.suite.cases.find(({ id }) => id === oracle.case_id);
  assert.ok(suiteCase);
  return {
    case_id: oracle.case_id,
    completion_status: "completed",
    lane: corpus.lane,
    lane_result: specialistResult(corpus, oracle, priority),
    schema_version: 1,
    smoke_gate: smokeGate(suiteCase),
    subject_commit: subjectCommit,
  };
}

test("all three pairs produce deterministic zero-positive non-qualifying previews", () => {
  for (const corpus of corpora) {
    const input = {
      normalizedCases: corpus.oracles.map((oracle) =>
        normalizedCase(corpus, oracle)
      ),
      oracles: corpus.oracles,
      suite: corpus.suite,
    };
    const preview = previewSuite(input);
    const pair = preview.pairs[0];

    assert.equal(preview.completion_status, "complete");
    assert.equal(preview.preview_assertions, "met");
    assert.deepEqual(pair.detection, { denominator: 1, numerator: 1 });
    assert.deepEqual(pair.finding_precision, {
      denominator: 1,
      numerator: 1,
    });
    assert.equal(pair.control_positives, 0);
    assert.equal(pair.control_budget_met, true);
    assert.equal(pair.preview_assertions, "met");

    for (const output of [
      preview,
      preview.aggregate,
      pair,
      ...preview.cases,
    ]) {
      assert.equal(output.verification_status, "unverified");
      assert.equal(output.qualification, "not-evidence");
      assert.equal(output.result, null);
      assert.equal(output.confidentiality, "controller-secret");
    }
    const serialized = canonicalJson(preview);
    assert.equal(
      serialized,
      canonicalJson(previewSuite(structuredClone(input))),
    );
    for (const token of oracleTokens(corpus.oracles)) {
      assert.equal(serialized.includes(token), false);
    }

    for (const priority of ["P0", "P1", "P2", "P3"]) {
      const priorityPreview = previewSuite({
        normalizedCases: corpus.oracles.map((oracle) =>
          normalizedCase(corpus, oracle, priority)
        ),
        oracles: corpus.oracles,
        suite: corpus.suite,
      });
      assert.equal(priorityPreview.preview_assertions, "met");
      assert.equal(priorityPreview.verification_status, "unverified");
      assert.equal(priorityPreview.qualification, "not-evidence");
      assert.equal(priorityPreview.result, null);
    }
  }
});

test("closed artifacts for the new lanes retain every non-qualification field", () => {
  const artifactTree = sha256(canonicalJson([]));
  for (const corpus of corpora) {
    const closed = {
      artifacts: [],
      artifact_snapshot_root: "artifacts",
      artifact_tree_sha256: artifactTree,
      case_id: corpus.suite.cases[0].id,
      claims: {
        adapter_status: "not-run",
        artifact_inventory: "closed",
        context_isolation: "not-attested",
        execution_isolation: "not-attested",
        fixture_opacity: "not-attested",
        input_integrity: "verified",
        method_order: "unverified_by_report",
        network_isolation: "not-attested",
        state_authentication: "not-attested",
      },
      confidentiality: "controller-only",
      controller_commit: subjectCommit,
      lane: corpus.lane,
      node_version: process.version,
      qualification: "not-evidence",
      result: null,
      run_id: "run_0123456789abcdef0123456789abcdef",
      schema_version: 1,
      subject_commit: subjectCommit,
      suite_id: corpus.suite.id,
      verification_status: "unverified",
      workspace_tree_sha256: "0".repeat(64),
    };
    assert.equal(validateClosedCaseRun(closed), closed);
    assert.equal(closed.verification_status, "unverified");
    assert.equal(closed.qualification, "not-evidence");
    assert.equal(closed.result, null);
  }
});
