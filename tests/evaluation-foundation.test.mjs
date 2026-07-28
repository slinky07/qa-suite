import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  fixtureManifestDeclarationDigest,
  parseContractJson,
  validateFixtureManifest,
  validateNormalizedCase,
  validateOracle,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";
import {
  previewCase,
  previewSuite,
} from "../scripts/evaluation/scoring.mjs";

const caseIds = {
  adversarial: "fx_0123456789abcdef0123456789abcdef",
  control: "fx_fedcba9876543210fedcba9876543210",
};
const subjectCommit = "0123456789abcdef0123456789abcdef01234567";

function seal(character) {
  return `seal_${character.repeat(64)}`;
}

const tokens = {
  adversarialCanary: seal("1"),
  pair: seal("2"),
  expected: seal("3"),
  controlCanary: seal("4"),
  budget: seal("5"),
};
const bobReportIdentifiers = {
  adversarial: {
    core_flow_ids: ["flow_0123456789abcdef0123456789abcdef_01"],
    surface_id: "surface_0123456789abcdef0123456789abcdef",
  },
  control: {
    core_flow_ids: ["flow_fedcba9876543210fedcba9876543210_01"],
    surface_id: "surface_fedcba9876543210fedcba9876543210",
  },
};

function clone(value) {
  return structuredClone(value);
}

function caseRoot(caseId) {
  return `tests/evaluation/fixtures/${caseId}`;
}

function suiteFixture(lane = "bob-qa") {
  const reportIdentifiers = (role) =>
    lane === "bob-qa"
      ? { report_identifiers: clone(bobReportIdentifiers[role]) }
      : {};
  return {
    cases: [
      {
        fixture_manifest:
          `${caseRoot(caseIds.adversarial)}/fixture-manifest.json`,
        id: caseIds.adversarial,
        oracle_commitments: [
          tokens.adversarialCanary,
          tokens.expected,
        ],
        qa_context: `${caseRoot(caseIds.adversarial)}/qa-context.md`,
        ...reportIdentifiers("adversarial"),
        smoke_checks: ["check_primary"],
      },
      {
        fixture_manifest:
          `${caseRoot(caseIds.control)}/fixture-manifest.json`,
        id: caseIds.control,
        oracle_commitments: [
          tokens.controlCanary,
          tokens.budget,
        ],
        qa_context: `${caseRoot(caseIds.control)}/qa-context.md`,
        ...reportIdentifiers("control"),
        smoke_checks: ["check_primary"],
      },
    ],
    id: `${lane.replace("-qa", "")}-evaluation-v1`,
    lane,
    schema_version: 1,
  };
}

function fixtureManifest(suiteCase) {
  return {
    case_id: suiteCase.id,
    files: [
      {
        mode: "100755",
        path: `${caseRoot(suiteCase.id)}/public/run.sh`,
        sha256: "b".repeat(64),
      },
      {
        mode: "100644",
        path: suiteCase.qa_context,
        sha256: "a".repeat(64),
      },
    ],
    schema_version: 1,
  };
}

function flowAssertion(role) {
  return {
    allowed_effectiveness: [true],
    allowed_states: ["Pass"],
    id: bobReportIdentifiers[role].core_flow_ids[0],
    required_evidence_kinds: ["screenshot"],
  };
}

function adversarialOracle(lane = "bob-qa") {
  const smoke = lane === "smoke-qa";
  return {
    assertions: {
      allowed_verdicts: smoke ? ["No-Go"] : ["Go with findings"],
      control_budget: null,
      expected_defects: [
        smoke
          ? {
              checklist_ids_any_of: ["check_primary"],
              id: tokens.expected,
              required_evidence_kinds: ["log"],
            }
          : {
              allowed_priorities: ["P1", "P2"],
              allowed_severities: ["S3", "S4"],
              criteria_any_of: ["H8", "IA-01"],
              id: tokens.expected,
              required_evidence_kinds: ["screenshot"],
              surface_id:
                bobReportIdentifiers.adversarial.surface_id,
            },
      ],
      flows: smoke ? [] : [flowAssertion("adversarial")],
    },
    canary_token: tokens.adversarialCanary,
    case_id: caseIds.adversarial,
    pair_id: tokens.pair,
    role: "adversarial",
    schema_version: 1,
  };
}

function controlOracle(lane = "bob-qa") {
  const smoke = lane === "smoke-qa";
  return {
    assertions: {
      allowed_verdicts: smoke ? ["Go"] : ["Go", "Go with findings"],
      control_budget: {
        criteria_any_of: smoke ? [] : ["H8", "IA-01"],
        id: tokens.budget,
        max_by_severity: smoke
          ? null
          : {
              S1: 0,
              S2: 0,
              S3: 0,
              S4: null,
            },
        max_total: smoke ? 0 : null,
        observations: "record-only",
        surface_ids: smoke
          ? []
          : [bobReportIdentifiers.control.surface_id],
      },
      expected_defects: [],
      flows: smoke ? [] : [flowAssertion("control")],
    },
    canary_token: tokens.controlCanary,
    case_id: caseIds.control,
    pair_id: tokens.pair,
    role: "control",
    schema_version: 1,
  };
}

function evidence(kind = "screenshot", name = "configuration.png") {
  return [{ kind, path: `evidence/${name}` }];
}

function finding(overrides = {}) {
  return {
    classification: "governed",
    criteria: ["H8", "IA-01"],
    evidence: evidence(),
    id: "BOB-01",
    priority: "P2",
    severity: "S4",
    surface_id: bobReportIdentifiers.adversarial.surface_id,
    ...overrides,
  };
}

function counts(findings) {
  return {
    S1: findings.filter(({ severity }) => severity === "S1").length,
    S2: findings.filter(({ severity }) => severity === "S2").length,
    S3: findings.filter(({ severity }) => severity === "S3").length,
    S4: findings.filter(({ severity }) => severity === "S4").length,
  };
}

function specialistResult({
  blocker = null,
  findings = [],
  flows,
  observations = [],
  reportRole = "adversarial",
  state = findings.length > 0 ? "Go with findings" : "Go",
} = {}) {
  const selectedFlows = flows ?? [
    {
      core: true,
      effectiveness: true,
      evidence: evidence(),
      finding_ids: [],
      id: bobReportIdentifiers[reportRole].core_flow_ids[0],
      state: "Pass",
    },
  ];
  return {
    blocking_evidence: [],
    checklist: [],
    findings,
    flows: selectedFlows,
    not_tested: [],
    observations,
    verdict: {
      blocker,
      severity_counts: counts(findings),
      state,
    },
  };
}

function smokeResult({
  blocker = null,
  checklist = [
    {
      evidence: [],
      id: "check_primary",
      state: "Pass",
    },
  ],
  state = "Go",
} = {}) {
  const failedEvidence = checklist
    .filter((item) => item.state === "Fail")
    .flatMap(({ evidence: pointers }) => pointers);
  return {
    blocking_evidence: state === "No-Go" ? failedEvidence : [],
    checklist,
    findings: [],
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker,
      severity_counts: null,
      state,
    },
  };
}

function normalizedCase(
  caseId,
  {
    completionStatus = "completed",
    findings,
    lane = "bob-qa",
    laneResult,
    smokeGate,
  } = {},
) {
  const adversarial = caseId === caseIds.adversarial;
  const selectedResult =
    laneResult === undefined
      ? lane === "smoke-qa"
        ? smokeResult({
            checklist: adversarial
              ? [
                  {
                    evidence: evidence("log", "smoke.log"),
                    id: "check_primary",
                    state: "Fail",
                  },
                ]
              : undefined,
            state: adversarial ? "No-Go" : "Go",
          })
        : specialistResult({
            findings:
              findings ?? (adversarial ? [finding()] : []),
            reportRole: adversarial ? "adversarial" : "control",
          })
      : laneResult;
  return {
    case_id: caseId,
    completion_status: completionStatus,
    lane,
    lane_result: selectedResult,
    schema_version: 1,
    smoke_gate:
      lane === "smoke-qa" ? null : (smokeGate ?? smokeResult()),
    subject_commit: subjectCommit,
  };
}

function previewFixture(lane = "bob-qa") {
  const suite = suiteFixture(lane);
  const oracles = [
    adversarialOracle(lane),
    controlOracle(lane),
  ];
  const normalizedCases = [
    normalizedCase(caseIds.adversarial, { lane }),
    normalizedCase(caseIds.control, { lane }),
  ];
  return { normalizedCases, oracles, suite };
}

test("suite contract is strict and uses neutral opaque paths", () => {
  const suite = suiteFixture();
  assert.equal(validateSuite(suite), suite);
  assert.deepEqual(
    suite.cases[0].report_identifiers,
    bobReportIdentifiers.adversarial,
  );

  const unknown = clone(suite);
  unknown.unexpected = true;
  assert.throws(() => validateSuite(unknown), /fields are/);

  const missingIdentifiers = clone(suite);
  delete missingIdentifiers.cases[0].report_identifiers;
  assert.throws(
    () => validateSuite(missingIdentifiers),
    /report_identifiers is required/u,
  );

  const extraIdentifierField = clone(suite);
  extraIdentifierField.cases[0].report_identifiers.role = "control";
  assert.throws(
    () => validateSuite(extraIdentifierField),
    /fields are/u,
  );

  const duplicateFlow = clone(suite);
  duplicateFlow.cases[0].report_identifiers.core_flow_ids.push(
    duplicateFlow.cases[0].report_identifiers.core_flow_ids[0],
  );
  assert.throws(
    () => validateSuite(duplicateFlow),
    /core_flow_ids must contain unique/u,
  );

  const unsortedFlows = clone(suite);
  unsortedFlows.cases[0].report_identifiers.core_flow_ids = [
    "flow_secondary",
    "flow_primary",
  ];
  assert.throws(
    () => validateSuite(unsortedFlows),
    /core_flow_ids must be sorted/u,
  );

  const malformedSurface = clone(suite);
  malformedSurface.cases[0].report_identifiers.surface_id =
    "surface_../control";
  assert.throws(
    () => validateSuite(malformedSurface),
    /surface_id has an invalid value/u,
  );

  const roleNamedSurface = clone(suite);
  roleNamedSurface.cases[0].report_identifiers.surface_id =
    "surface_adversarial";
  assert.throws(
    () => validateSuite(roleNamedSurface),
    /surface_id must be opaque and case-bound/u,
  );

  const roleNamedFlow = clone(suite);
  roleNamedFlow.cases[0].report_identifiers.core_flow_ids = [
    "flow_control",
  ];
  assert.throws(
    () => validateSuite(roleNamedFlow),
    /core_flow_ids must be opaque and case-bound/u,
  );

  const nonBobSuite = suiteFixture("security-qa");
  nonBobSuite.cases[0].report_identifiers =
    clone(bobReportIdentifiers.adversarial);
  assert.throws(
    () => validateSuite(nonBobSuite),
    /only supported for bob-qa/u,
  );

  const duplicate = clone(suite);
  duplicate.cases[1].id = duplicate.cases[0].id;
  duplicate.cases[1].qa_context = duplicate.cases[0].qa_context;
  duplicate.cases[1].fixture_manifest =
    duplicate.cases[0].fixture_manifest;
  duplicate.cases[1].report_identifiers =
    clone(duplicate.cases[0].report_identifiers);
  assert.throws(() => validateSuite(duplicate), /case IDs.*unique/);

  const roleLeaking = clone(suite);
  roleLeaking.cases[0].qa_context =
    `tests/evaluation/fixtures/adversarial/${caseIds.adversarial}/qa-context.md`;
  assert.throws(
    () => validateSuite(roleLeaking),
    /opaque neutral path/,
  );
});

test("serialized contract input rejects duplicate JSON keys", () => {
  assert.throws(
    () =>
      parseContractJson(
        '{"schema_version":1,"schema_version":1}',
        "suite",
      ),
    /duplicate object key "schema_version"/,
  );
});

test("fixture manifest lists the exact qa-context and public regular files", () => {
  const suiteCase = suiteFixture().cases[0];
  const manifest = fixtureManifest(suiteCase);

  assert.equal(validateFixtureManifest(manifest, suiteCase), manifest);
  const declarationDigest = fixtureManifestDeclarationDigest(
    manifest,
    suiteCase,
  );
  assert.match(declarationDigest.digest, /^[0-9a-f]{64}$/);
  assert.equal(declarationDigest.verification_status, "unverified");
  assert.equal(declarationDigest.qualification, "not-evidence");
  assert.deepEqual(
    declarationDigest,
    fixtureManifestDeclarationDigest(clone(manifest), clone(suiteCase)),
  );

  const missingContext = clone(manifest);
  missingContext.files = missingContext.files.filter(
    ({ path }) => path !== suiteCase.qa_context,
  );
  assert.throws(
    () => validateFixtureManifest(missingContext, suiteCase),
    /include the exact qa-context/,
  );

  const unsafe = clone(manifest);
  unsafe.files[1].path = `${caseRoot(suiteCase.id)}/public/../oracle.json`;
  assert.throws(
    () => validateFixtureManifest(unsafe, suiteCase),
    /normalized visible relative path/,
  );

  const symlink = clone(manifest);
  symlink.files[1].mode = "120000";
  assert.throws(
    () => validateFixtureManifest(symlink, suiteCase),
    /100644 or 100755/,
  );
});

test("oracle set requires one adversarial and one control with sealed commitments", () => {
  const suite = suiteFixture();
  const oracles = [adversarialOracle(), controlOracle()];

  assert.equal(validateOracleSet(oracles, suite), oracles);
  assert.equal(canonicalJson(suite).includes(tokens.pair), false);

  const duplicateRole = clone(oracles);
  duplicateRole[1].role = "adversarial";
  duplicateRole[1].assertions = clone(duplicateRole[0].assertions);
  duplicateRole[1].assertions.expected_defects[0].id = tokens.budget;
  duplicateRole[1].assertions.expected_defects[0].surface_id =
    bobReportIdentifiers.control.surface_id;
  duplicateRole[1].assertions.flows[0].id =
    bobReportIdentifiers.control.core_flow_ids[0];
  assert.throws(
    () => validateOracleSet(duplicateRole, suite),
    (error) => {
      assert.equal(error.message.includes(tokens.pair), false);
      assert.match(error.message, /one adversarial and one control/u);
      return true;
    },
  );

  const reusedToken = clone(oracles);
  reusedToken[1].canary_token = tokens.adversarialCanary;
  reusedToken[1].assertions.control_budget.id = tokens.controlCanary;
  reusedToken[1].case_id = caseIds.control;
  reusedToken[1].pair_id = tokens.pair;
  suite.cases[1].oracle_commitments = [
    tokens.adversarialCanary,
    tokens.controlCanary,
  ];
  assert.throws(
    () => validateOracleSet(reusedToken, suite),
    /suite oracle commitments.*unique/,
  );

  const reversed = [...oracles].reverse();
  const freshSuite = suiteFixture();
  assert.equal(validateOracleSet(reversed, freshSuite), reversed);

  const repeatedIdentifierSuite = clone(freshSuite);
  repeatedIdentifierSuite.cases[1].report_identifiers.surface_id =
    repeatedIdentifierSuite.cases[0].report_identifiers.surface_id;
  assert.throws(
    () => validateSuite(repeatedIdentifierSuite),
    /surface_id must be opaque and case-bound/u,
  );

  const unknownSurface = adversarialOracle();
  unknownSurface.assertions.expected_defects[0].surface_id =
    "surface_other";
  assert.throws(
    () => validateOracle(unknownSurface, freshSuite, freshSuite.cases[0]),
    /surface must equal the public surface ID/u,
  );

  const unknownFlow = adversarialOracle();
  unknownFlow.assertions.flows[0].id = "flow_other";
  assert.throws(
    () => validateOracle(unknownFlow, freshSuite, freshSuite.cases[0]),
    /flow IDs must equal the public core flow IDs/u,
  );

  const accessorCase = clone(freshSuite.cases[0]);
  const validIdentifiers = clone(accessorCase.report_identifiers);
  let identifierReads = 0;
  Object.defineProperty(accessorCase, "report_identifiers", {
    enumerable: true,
    get() {
      identifierReads += 1;
      return identifierReads === 1
        ? validIdentifiers
        : {
            core_flow_ids: ["flow_control"],
            surface_id: "surface_adversarial",
          };
    },
  });
  assert.equal(
    validateOracle(
      adversarialOracle(),
      freshSuite,
      accessorCase,
    ).case_id,
    caseIds.adversarial,
  );
  assert.equal(identifierReads, 1);
});

test("oracle verdict bands are derived from role, lane, and Severity", () => {
  const suite = suiteFixture();
  const adversarial = adversarialOracle();
  adversarial.assertions.allowed_verdicts = ["Go"];
  assert.throws(
    () => validateOracle(adversarial, suite, suite.cases[0]),
    /allowed_verdicts must equal Go with findings/,
  );

  const control = controlOracle();
  control.assertions.allowed_verdicts = ["No-Go"];
  assert.throws(
    () => validateOracle(control, suite, suite.cases[1]),
    /allowed_verdicts must equal Go, Go with findings/,
  );

  const smokeSuite = suiteFixture("smoke-qa");
  const smokeAdversarial = adversarialOracle("smoke-qa");
  smokeAdversarial.assertions.allowed_verdicts = ["Go with findings"];
  assert.throws(
    () =>
      validateOracle(
        smokeAdversarial,
        smokeSuite,
        smokeSuite.cases[0],
      ),
    /allowed_verdicts must equal No-Go/,
  );
});

test("control budget cannot be unbounded or tolerate S1/S2", () => {
  const suite = suiteFixture();
  const unbounded = controlOracle();
  unbounded.assertions.control_budget.max_by_severity = {
    S1: null,
    S2: null,
    S3: null,
    S4: null,
  };
  assert.throws(
    () => validateOracle(unbounded, suite, suite.cases[1]),
    /at least one finite limit/,
  );

  const highSeverity = controlOracle();
  highSeverity.assertions.control_budget.max_by_severity.S2 = 1;
  assert.throws(
    () => validateOracle(highSeverity, suite, suite.cases[1]),
    /reject S1 and S2/,
  );
});

test("complete pair yields deterministic non-qualifying preview math", () => {
  const fixture = previewFixture();
  const first = previewSuite(fixture);
  const second = previewSuite(clone(fixture));

  assert.equal(first.completion_status, "complete");
  assert.equal(first.preview_assertions, "met");
  assert.equal(first.verification_status, "unverified");
  assert.equal(first.qualification, "not-evidence");
  assert.equal(first.result, null);
  assert.deepEqual(first.pairs[0].detection, {
    denominator: 1,
    numerator: 1,
  });
  assert.deepEqual(first.pairs[0].finding_precision, {
    denominator: 1,
    numerator: 1,
  });
  assert.equal(first.pairs[0].control_budget_met, true);
  assert.equal(canonicalJson(first), canonicalJson(second));
  for (const token of Object.values(tokens)) {
    assert.equal(canonicalJson(first).includes(token), false);
  }
});

test("detection requires classification and evidence on the same finding", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[0].lane_result = specialistResult({
    findings: [
      finding({
        evidence: evidence("log", "first.log"),
        id: "BOB-CLASSIFICATION",
      }),
      finding({
        id: "BOB-EVIDENCE",
        priority: "P3",
      }),
    ],
  });

  const result = previewSuite(fixture);

  assert.equal(result.cases[0].detection.status, "matched");
  assert.equal(result.cases[0].detection.classification.priority, "met");
  assert.equal(result.cases[0].detection.evidence, "met");
  assert.equal(result.cases[0].detection.complete_match, "not_met");
  assert.equal(result.cases[0].preview_assertions, "not_met");
  assert.equal(result.result, null);
});

test("S4 control positive lowers precision without exceeding its budget", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[1].lane_result = specialistResult({
    findings: [
      finding({
        id: "BOB-CONTROL-01",
        surface_id: bobReportIdentifiers.control.surface_id,
      }),
    ],
    reportRole: "control",
  });

  const result = previewSuite(fixture);

  assert.equal(result.pairs[0].control_budget_met, true);
  assert.deepEqual(result.pairs[0].finding_precision, {
    denominator: 2,
    numerator: 1,
  });
  assert.equal(result.preview_assertions, "met");
  assert.equal(result.result, null);
});

test("S3 control positive exceeds the configured budget", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[1].lane_result = specialistResult({
    findings: [
      finding({
        id: "BOB-CONTROL-01",
        severity: "S3",
        surface_id: bobReportIdentifiers.control.surface_id,
      }),
    ],
    reportRole: "control",
  });

  const result = previewSuite(fixture);

  assert.equal(result.pairs[0].control_budget_met, false);
  assert.equal(result.preview_assertions, "not_met");
  assert.equal(result.result, null);
});

test("control budget scope does not narrow canonical verdict scope", () => {
  const fixture = previewFixture();
  fixture.oracles[1].assertions.control_budget.max_total = 0;
  fixture.oracles[1].assertions.control_budget.max_by_severity.S4 = 0;
  fixture.normalizedCases[1].lane_result = specialistResult({
    findings: [
      finding({
        criteria: ["OUT-OF-SCOPE"],
        id: "BOB-CONTROL-OUTSIDE",
        surface_id: "surface_other",
      }),
    ],
    reportRole: "control",
  });

  const result = previewSuite(fixture);

  assert.equal(result.cases[1].verdict, "Go with findings");
  assert.equal(result.cases[1].control.positive_count, 0);
  assert.equal(result.cases[1].control.budget_met, true);
  assert.equal(result.preview_assertions, "met");
  assert.deepEqual(result.pairs[0].finding_precision, {
    denominator: 1,
    numerator: 1,
  });
});

test("behavioral miss remains an unverified preview with no false score", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[0].lane_result = specialistResult();
  fixture.oracles[0].assertions.allowed_verdicts = ["Go with findings"];

  const result = previewSuite(fixture);

  assert.equal(result.cases[0].detection.status, "missed");
  assert.equal(result.cases[0].preview_assertions, "not_met");
  assert.deepEqual(result.pairs[0].detection, {
    denominator: 1,
    numerator: 0,
  });
  assert.equal(result.pairs[0].finding_precision, null);
  assert.equal(result.verification_status, "unverified");
  assert.equal(result.result, null);
});

test("lane Blocked is incomplete and contributes no denominator", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[0] = normalizedCase(caseIds.adversarial, {
    completionStatus: "lane-blocked",
    laneResult: specialistResult({
      blocker: "browser policy prevented launch",
      state: "Blocked",
    }),
  });

  const result = previewSuite(fixture);

  assert.equal(result.completion_status, "incomplete");
  assert.equal(result.cases[0].completion_status, "incomplete");
  assert.equal(result.cases[0].preview_assertions, null);
  assert.equal(result.pairs[0].detection, null);
  assert.equal(result.aggregate.detection, null);
  assert.equal(result.result, null);
});

test("Blocked cannot suppress confirmed No-Go evidence", () => {
  const specialistSuite = suiteFixture();
  const criticalFinding = normalizedCase(caseIds.adversarial, {
    completionStatus: "lane-blocked",
    laneResult: specialistResult({
      blocker: "browser closed after the result",
      findings: [finding({ severity: "S2" })],
      state: "Blocked",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(criticalFinding, specialistSuite),
    /cannot be Blocked when confirmed evidence requires No-Go/,
  );

  const coreFailure = normalizedCase(caseIds.adversarial, {
    completionStatus: "lane-blocked",
    laneResult: specialistResult({
      blocker: "browser closed after the result",
      flows: [
        {
          core: true,
          effectiveness: false,
          evidence: evidence("log", "core-flow.log"),
          finding_ids: [],
          id: "flow_primary",
          state: "Fail",
        },
      ],
      state: "Blocked",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(coreFailure, specialistSuite),
    /cannot be Blocked when confirmed evidence requires No-Go/,
  );

  const smokeSuite = suiteFixture("smoke-qa");
  const failedSmoke = normalizedCase(caseIds.adversarial, {
    completionStatus: "lane-blocked",
    lane: "smoke-qa",
    laneResult: smokeResult({
      blocker: "browser closed after the result",
      checklist: [
        {
          evidence: evidence("log", "launch.log"),
          id: "check_primary",
          state: "Fail",
        },
      ],
      state: "Blocked",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(failedSmoke, smokeSuite),
    /Blocked cannot suppress a failed smoke checklist item/,
  );
});

test("Blocked requires a named non-whitespace blocker", () => {
  const suite = suiteFixture();
  const value = normalizedCase(caseIds.adversarial, {
    completionStatus: "lane-blocked",
    laneResult: specialistResult({
      blocker: "   ",
      state: "Blocked",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(value, suite),
    /must be a non-empty string/,
  );
});

test("smoke No-Go gates deeper execution without lane output", () => {
  const suite = suiteFixture();
  const gated = normalizedCase(caseIds.adversarial, {
    completionStatus: "gated-by-smoke",
    laneResult: null,
    smokeGate: smokeResult({
      checklist: [
        {
          evidence: evidence("log", "launch.log"),
          id: "check_primary",
          state: "Fail",
        },
      ],
      state: "No-Go",
    }),
  });

  assert.equal(validateNormalizedCase(gated, suite), gated);
  const preview = previewCase({
    normalizedCase: gated,
    oracle: adversarialOracle(),
    suite,
    suiteCase: suite.cases[0],
  });
  assert.equal(preview.completion_status, "incomplete");
  assert.equal(preview.detection, null);
  assert.equal(preview.verdict, "No-Go");
  assert.equal(preview.result, null);
});

test("smoke Blocked gates deeper execution without counting as detection", () => {
  const fixture = previewFixture();
  fixture.normalizedCases[0] = normalizedCase(caseIds.adversarial, {
    completionStatus: "gated-by-smoke",
    laneResult: null,
    smokeGate: smokeResult({
      blocker: "browser unavailable",
      checklist: [],
      state: "Blocked",
    }),
  });

  const result = previewSuite(fixture);

  assert.equal(result.completion_status, "incomplete");
  assert.equal(result.cases[0].verdict, "Blocked");
  assert.equal(result.cases[0].detection, null);
  assert.equal(result.pairs[0].detection, null);
});

test("smoke No-Go requires a structured failed checklist signal and evidence", () => {
  const suite = suiteFixture("smoke-qa");
  const noFailure = normalizedCase(caseIds.adversarial, {
    lane: "smoke-qa",
    laneResult: smokeResult({
      checklist: [],
      state: "No-Go",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(noFailure, suite),
    /failed checklist item and blocking evidence/,
  );

  const noEvidence = normalizedCase(caseIds.adversarial, {
    lane: "smoke-qa",
    laneResult: smokeResult({
      checklist: [
        {
          evidence: [],
          id: "check_primary",
          state: "Fail",
        },
      ],
      state: "No-Go",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(noEvidence, suite),
    /requires evidence/,
  );

  const emptyGo = normalizedCase(caseIds.control, {
    lane: "smoke-qa",
    laneResult: smokeResult({
      checklist: [],
      state: "Go",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(emptyGo, suite),
    /requires every declared smoke check exactly once and passed/,
  );
});

test("smoke adversarial/control pair previews checklist detection", () => {
  const result = previewSuite(previewFixture("smoke-qa"));

  assert.equal(result.preview_assertions, "met");
  assert.equal(result.cases[0].detection.status, "matched");
  assert.equal(
    result.cases[0].detection.classification,
    "not_applicable_by_lane_contract",
  );
  assert.deepEqual(result.pairs[0].detection, {
    denominator: 1,
    numerator: 1,
  });
  assert.equal(result.result, null);
});

test("canonical verdict follows Severity and core flow, not Priority", () => {
  const suite = suiteFixture();
  const lowPriorityCritical = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      findings: [
        finding({
          priority: "P3",
          severity: "S2",
        }),
      ],
      state: "No-Go",
    }),
  });
  assert.equal(validateNormalizedCase(lowPriorityCritical, suite), lowPriorityCritical);

  const contradictory = clone(lowPriorityCritical);
  contradictory.lane_result.verdict.state = "Go with findings";
  assert.throws(
    () => validateNormalizedCase(contradictory, suite),
    /contradicts canonical Severity/,
  );

  const coreFlowFailure = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: true,
          effectiveness: false,
          evidence: evidence("log", "flow.log"),
          finding_ids: [],
          id: "flow_primary",
          state: "Fail",
        },
      ],
      state: "No-Go",
    }),
  });
  assert.equal(validateNormalizedCase(coreFlowFailure, suite), coreFlowFailure);
});

test("verdict counts must equal the normalized finding ledger", () => {
  const suite = suiteFixture();
  const value = normalizedCase(caseIds.adversarial);
  value.lane_result.verdict.severity_counts.S4 = 2;

  assert.throws(
    () => validateNormalizedCase(value, suite),
    /does not match normalized findings/,
  );
});

test("unsafe flow claims and unknown finding joins fail closed", () => {
  const suite = suiteFixture();
  const observedOnly = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: false,
          effectiveness: true,
          evidence: [],
          finding_ids: [],
          id: "flow_primary",
          state: "Observed only",
        },
      ],
    }),
  });
  assert.throws(
    () => validateNormalizedCase(observedOnly, suite),
    /cannot claim effectiveness/,
  );

  const unsupportedPass = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: false,
          effectiveness: true,
          evidence: [],
          finding_ids: [],
          id: "flow_primary",
          state: "Pass",
        },
      ],
    }),
  });
  assert.throws(
    () => validateNormalizedCase(unsupportedPass, suite),
    /requires evidence for Pass/,
  );

  const unsupportedBlocked = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: true,
          effectiveness: null,
          evidence: [],
          finding_ids: [],
          id: "flow_primary",
          state: "Blocked",
        },
      ],
    }),
  });
  assert.throws(
    () => validateNormalizedCase(unsupportedBlocked, suite),
    /requires evidence for Blocked/,
  );

  const hiddenCoreBlocker = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: true,
          effectiveness: null,
          evidence: evidence("log", "blocked-flow.log"),
          finding_ids: [],
          id: "flow_primary",
          state: "Blocked",
        },
      ],
      state: "Go",
    }),
  });
  assert.throws(
    () => validateNormalizedCase(hiddenCoreBlocker, suite),
    /contradicts canonical Severity and core-flow semantics/,
  );

  const unknownFinding = normalizedCase(caseIds.adversarial, {
    laneResult: specialistResult({
      flows: [
        {
          core: false,
          effectiveness: true,
          evidence: evidence("log", "flow.log"),
          finding_ids: ["UNKNOWN-01"],
          id: "flow_primary",
          state: "Pass",
        },
      ],
    }),
  });
  assert.throws(
    () => validateNormalizedCase(unknownFinding, suite),
    /references unknown finding/,
  );
});

test("flow assertions require their configured evidence kinds", () => {
  const fixture = previewFixture();
  fixture.oracles[0].assertions.flows = [
    {
      allowed_effectiveness: [true],
      allowed_states: ["Pass"],
      id: bobReportIdentifiers.adversarial.core_flow_ids[0],
      required_evidence_kinds: ["screenshot"],
    },
  ];
  fixture.normalizedCases[0].lane_result.flows = [
    {
      core: false,
      effectiveness: true,
      evidence: evidence("log", "flow.log"),
      finding_ids: [],
      id: bobReportIdentifiers.adversarial.core_flow_ids[0],
      state: "Pass",
    },
  ];

  const result = previewSuite(fixture);

  assert.equal(result.cases[0].flow_assertions[0].state, "met");
  assert.equal(result.cases[0].flow_assertions[0].effectiveness, "met");
  assert.equal(result.cases[0].flow_assertions[0].evidence, "not_met");
  assert.equal(result.cases[0].flow_assertions[0].status, "not_met");
  assert.equal(result.preview_assertions, "not_met");
});

test("no input field can promote a preview to verified evidence", () => {
  const fixture = previewFixture();
  const promoted = clone(fixture.normalizedCases[0]);
  promoted.verification_status = "verified";
  assert.throws(
    () => validateNormalizedCase(promoted, fixture.suite),
    /fields are/,
  );

  const preview = previewSuite(fixture);
  for (const value of [
    preview,
    preview.aggregate,
    ...preview.cases,
    ...preview.pairs,
  ]) {
    assert.equal(value.verification_status, "unverified");
    assert.equal(value.qualification, "not-evidence");
    assert.equal(value.result, null);
    assert.equal(value.confidentiality, "controller-secret");
  }
});
