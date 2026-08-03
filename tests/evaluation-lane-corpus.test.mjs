import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SHIPPED_LANES,
  parseContractJson,
  validateFixtureManifest,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const corpus = [
  {
    caseCount: 2,
    file: "api-evaluation-v1.json",
    lane: "api-qa",
    pairCount: 1,
  },
  {
    caseCount: 4,
    file: "bob-evaluation-v1.json",
    lane: "bob-qa",
    pairCount: 2,
  },
  {
    caseCount: 2,
    file: "compatibility-evaluation-v1.json",
    lane: "compatibility-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "data-integrity-evaluation-v1.json",
    lane: "data-integrity-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "deployment-evaluation-v1.json",
    lane: "deployment-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "performance-evaluation-v1.json",
    lane: "performance-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "regression-evaluation-v1.json",
    lane: "regression-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "reliability-evaluation-v1.json",
    lane: "reliability-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "security-evaluation-v1.json",
    lane: "security-qa",
    pairCount: 1,
  },
  {
    caseCount: 2,
    file: "smoke-evaluation-v1.json",
    lane: "smoke-qa",
    pairCount: 1,
  },
];

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

async function jsonFiles(directory) {
  return (await readdir(join(repositoryRoot, directory), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(({ name }) => name)
    .sort();
}

function assertUnique(values, label) {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} must be globally unique`,
  );
}

function assertionToken(oracle) {
  return oracle.role === "adversarial"
    ? oracle.assertions.expected_defects[0].id
    : oracle.assertions.control_budget.id;
}

function assertScoringContract(oracle, lane) {
  for (const flow of oracle.assertions.flows) {
    assert.ok(flow.allowed_states.length > 0);
    assert.ok(flow.allowed_effectiveness.length > 0);
    assert.ok(flow.required_evidence_kinds.length > 0);
  }

  if (oracle.role === "adversarial") {
    assert.equal(oracle.assertions.control_budget, null);
    assert.equal(oracle.assertions.expected_defects.length, 1);
    const defect = oracle.assertions.expected_defects[0];
    assert.ok(defect.required_evidence_kinds.length > 0);
    if (lane === "smoke-qa") {
      assert.ok(defect.checklist_ids_any_of.length > 0);
    } else {
      assert.ok(defect.criteria_any_of.length > 0);
      assert.ok(defect.allowed_severities.length > 0);
      assert.ok(defect.allowed_priorities.length > 0);
    }
    return;
  }

  assert.deepEqual(oracle.assertions.expected_defects, []);
  const budget = oracle.assertions.control_budget;
  assert.notEqual(budget, null);
  assert.equal(budget.observations, "record-only");
  if (lane === "smoke-qa") {
    assert.equal(budget.max_total, 0);
    assert.equal(budget.max_by_severity, null);
  } else {
    assert.deepEqual(
      Object.keys(budget.max_by_severity),
      ["S1", "S2", "S3", "S4"],
    );
    assert.equal(budget.max_by_severity.S1, 0);
    assert.equal(budget.max_by_severity.S2, 0);
    assert.ok(
      budget.max_total !== null ||
        Object.values(budget.max_by_severity).some(
          (limit) => limit !== null,
        ),
    );
  }
}

test("the committed corpus covers exactly ten shipped lanes without cross-suite token reuse", async () => {
  assert.equal(SHIPPED_LANES.size, 10);
  assert.equal(
    [...SHIPPED_LANES].some((lane) => lane.startsWith("temporary-qa-")),
    false,
  );
  const expectedFiles = corpus.map(({ file }) => file).sort();
  assert.deepEqual(
    await jsonFiles("tests/evaluation/suites"),
    expectedFiles,
  );
  assert.deepEqual(
    await jsonFiles("tests/evaluation/oracles"),
    expectedFiles,
  );

  const caseIds = [];
  const commitments = [];
  const lanes = [];
  const nonPairTokens = [];
  const pairTokens = [];
  let adversarialCount = 0;
  let controlCount = 0;

  for (const expected of corpus) {
    const suite = validateSuite(
      await readContract(
        `tests/evaluation/suites/${expected.file}`,
        `${expected.lane} suite`,
      ),
    );
    const oracles = validateOracleSet(
      await readContract(
        `tests/evaluation/oracles/${expected.file}`,
        `${expected.lane} oracle set`,
      ),
      suite,
    );

    assert.equal(suite.id, expected.file.slice(0, -".json".length));
    assert.equal(suite.lane, expected.lane);
    assert.equal(suite.cases.length, expected.caseCount);
    const suitePairTokens = [...new Set(
      oracles.map(({ pair_id: pairId }) => pairId),
    )];
    assert.equal(suitePairTokens.length, expected.pairCount);

    lanes.push(suite.lane);
    pairTokens.push(...suitePairTokens);
    caseIds.push(...suite.cases.map(({ id }) => id));
    commitments.push(
      ...suite.cases.flatMap(
        ({ oracle_commitments: values }) => values,
      ),
    );

    for (const suiteCase of suite.cases) {
      const manifest = await readContract(
        suiteCase.fixture_manifest,
        `${suiteCase.id} fixture manifest`,
      );
      assert.equal(
        validateFixtureManifest(manifest, suiteCase),
        manifest,
      );
    }

    for (const oracle of oracles) {
      nonPairTokens.push(oracle.canary_token, assertionToken(oracle));
      if (oracle.role === "adversarial") {
        adversarialCount += 1;
      } else {
        controlCount += 1;
      }
      assertScoringContract(oracle, suite.lane);
    }
  }

  assert.deepEqual([...lanes].sort(), [...SHIPPED_LANES].sort());
  assert.equal(caseIds.length, 22);
  assert.equal(pairTokens.length, 11);
  assert.equal(adversarialCount, 11);
  assert.equal(controlCount, 11);
  assertUnique(caseIds, "case IDs");
  assertUnique(commitments, "public oracle commitments");
  assertUnique(nonPairTokens, "oracle canary and assertion tokens");
  assertUnique(pairTokens, "oracle pair tokens");
  assert.deepEqual([...commitments].sort(), [...nonPairTokens].sort());

  const nonPairTokenSet = new Set(nonPairTokens);
  assert.equal(
    pairTokens.some((token) => nonPairTokenSet.has(token)),
    false,
    "pair tokens must be disjoint from public commitments",
  );

  const maintainerReference = await readFile(
    join(repositoryRoot, "tests/evaluation/README.md"),
    "utf8",
  );
  for (const token of [...nonPairTokens, ...pairTokens]) {
    assert.equal(
      maintainerReference.includes(token),
      false,
      "committed controller tokens must not collide with labeled examples",
    );
  }
});

test("the fixed evaluator rejects temporary-specialist identities", async () => {
  const suite = await readContract(
    "tests/evaluation/suites/reliability-evaluation-v1.json",
    "reliability suite",
  );
  suite.lane =
    "temporary-qa-resilience-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  assert.throws(
    () => validateSuite(suite),
    /suite\.lane has unsupported value temporary-qa-resilience-/u,
  );
});
