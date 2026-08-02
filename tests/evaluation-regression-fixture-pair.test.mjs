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
  validateFixtureManifest,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";
import { previewSuite } from "../scripts/evaluation/scoring.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const suite = await readContract(
  "tests/evaluation/suites/regression-evaluation-v1.json",
  "regression suite",
);
const oracles = await readContract(
  "tests/evaluation/oracles/regression-evaluation-v1.json",
  "regression oracle set",
);
const caseById = new Map(
  suite.cases.map((suiteCase) => [suiteCase.id, suiteCase]),
);
const adversarial = oracles.find(({ role }) => role === "adversarial");
const control = oracles.find(({ role }) => role === "control");
assert.ok(adversarial);
assert.ok(control);

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

function fixtureRoot(caseId) {
  return join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    caseId,
  );
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

function runNode(arguments_, environment = {}) {
  return spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function smokeGate() {
  return {
    blocking_evidence: [],
    checklist: [
      {
        evidence: [],
        id: "check_candidate_syntax",
        state: "Pass",
      },
    ],
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

function laneResult(role) {
  const findings = role === "adversarial"
    ? [
        {
          classification: "governed",
          criteria: ["regression"],
          evidence: [
            {
              kind: "report-reference",
              path: "QA/2026-07-29-1200-regression-cancellation-window.md",
            },
          ],
          id: "REG-01",
          priority: "P0",
          severity: "S2",
          surface_id: "surface_cancellation_window",
        },
      ]
    : [];
  return {
    blocking_evidence: [],
    checklist: [],
    findings,
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: {
        S1: 0,
        S2: findings.length,
        S3: 0,
        S4: 0,
      },
      state: findings.length === 0 ? "Go" : "No-Go",
    },
  };
}

function normalizedCase(oracle) {
  return {
    case_id: oracle.case_id,
    completion_status: "completed",
    lane: "regression-qa",
    lane_result: laneResult(oracle.role),
    schema_version: 1,
    smoke_gate: smokeGate(),
    subject_commit: "0123456789abcdef0123456789abcdef01234567",
  };
}

test("regression declarations seal exact role-neutral fixture bytes", async () => {
  assert.equal(validateSuite(suite), suite);
  assert.equal(validateOracleSet(oracles, suite), oracles);
  assert.equal(
    suite.cases.some((suiteCase) =>
      Object.hasOwn(suiteCase, "report_identifiers")
    ),
    false,
  );

  const seals = new Set(
    oracles.flatMap((oracle) => [
      oracle.pair_id,
      oracle.canary_token,
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    ]),
  );

  for (const suiteCase of suite.cases) {
    const manifest = await readContract(
      suiteCase.fixture_manifest,
      `${suiteCase.id} manifest`,
    );
    assert.equal(validateFixtureManifest(manifest, suiteCase), manifest);

    const publicFiles = await collectFiles(
      join(fixtureRoot(suiteCase.id), "public"),
    );
    const actualPaths = [
      ...publicFiles,
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
      selectedBytes += bytes.toString("utf8");
    }

    for (const seal of seals) {
      assert.equal(selectedBytes.includes(seal), false);
    }
    for (const sibling of suite.cases) {
      if (sibling.id !== suiteCase.id) {
        assert.equal(selectedBytes.includes(sibling.id), false);
      }
    }
    for (const forbidden of [
      /\badversarial\b/iu,
      /\bcontrol\b/iu,
      /\bexpected[_ -]?defect\b/iu,
      /\bpair[_ -]?id\b/iu,
      /seal_[0-9a-f]{64}/u,
    ]) {
      assert.equal(forbidden.test(selectedBytes), false);
    }
  }
});

test("the pair isolates one uncovered inclusive-boundary variable", async () => {
  const adversarialRoot = fixtureRoot(adversarial.case_id);
  const controlRoot = fixtureRoot(control.case_id);
  const sharedPaths = [
    "public/base/cancellation.mjs",
    "public/cancellation-suite.mjs",
    "public/findings.jsonl",
  ];
  for (const path of sharedPaths) {
    assert.equal(
      await readFile(join(adversarialRoot, path), "utf8"),
      await readFile(join(controlRoot, path), "utf8"),
    );
  }

  const contexts = await Promise.all(
    [adversarial, control].map(async (oracle) =>
      (await readFile(
        join(fixtureRoot(oracle.case_id), "qa-context.md"),
        "utf8",
      )).replaceAll(oracle.case_id, "fx_selected")
    ),
  );
  assert.equal(contexts[0], contexts[1]);

  const publicTest = await readFile(
    join(adversarialRoot, "public/cancellation-suite.mjs"),
    "utf8",
  );
  assert.doesNotMatch(publicTest, /canCancel\(30,\s*30\)/u);

  const adversarialCandidate = await readFile(
    join(adversarialRoot, "public/candidate/cancellation.mjs"),
    "utf8",
  );
  const controlCandidate = await readFile(
    join(controlRoot, "public/candidate/cancellation.mjs"),
    "utf8",
  );
  assert.equal(controlCandidate.replace(">=", ">"), adversarialCandidate);
  assert.equal((controlCandidate.match(/>=/gu) ?? []).length, 1);
  assert.equal((adversarialCandidate.match(/ > /gu) ?? []).length, 1);
});

test("both public suites pass while the focused boundary distinguishes roles", async () => {
  for (const suiteCase of suite.cases) {
    const root = fixtureRoot(suiteCase.id);
    const testPath = join(root, "public/cancellation-suite.mjs");
    for (const revision of ["base", "candidate"]) {
      const result = runNode(
        ["--test", testPath],
        { CANCELLATION_REVISION: revision },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
  }

  const modules = {};
  for (const [role, oracle] of Object.entries({
    adversarial,
    control,
  })) {
    const root = fixtureRoot(oracle.case_id);
    modules[`${role}Base`] = await import(
      pathToFileURL(join(root, "public/base/cancellation.mjs")).href
    );
    modules[`${role}Candidate`] = await import(
      pathToFileURL(join(root, "public/candidate/cancellation.mjs")).href
    );
  }

  assert.equal(modules.adversarialBase.canCancel(30, 30), true);
  assert.equal(modules.controlBase.canCancel(30, 30), true);
  assert.equal(modules.adversarialCandidate.canCancel(30, 30), false);
  assert.equal(modules.controlCandidate.canCancel(30, 30), true);
});

test("the sealed regression pair produces a non-qualifying exact preview", () => {
  const input = {
    normalizedCases: oracles.map(normalizedCase),
    oracles,
    suite,
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
  }
  const serialized = canonicalJson(preview);
  assert.equal(
    serialized,
    canonicalJson(previewSuite(structuredClone(input))),
  );
  for (const oracle of oracles) {
    assert.equal(serialized.includes(oracle.pair_id), false);
    assert.equal(serialized.includes(oracle.canary_token), false);
  }
});
