import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adaptClosedBobHostResult,
  bindClosedBobReport,
} from "../scripts/evaluation/bob-report-adapter.mjs";
import {
  executePreparedBobCase,
} from "../scripts/evaluation/bob-host-protocol.mjs";
import {
  canonicalJson,
  sha256,
  validateClosedBobReportAdaptation,
  validateClosedBobReportBinding,
} from "../scripts/evaluation/contracts.mjs";

const report = Object.freeze({
  mode: "0400",
  path: "QA/2026-07-28-0415-bob-qa-primary-surface.md",
  sha256: "a".repeat(64),
  size: 123,
});
const reportIdentifiers = Object.freeze({
  core_flow_ids: ["flow_00112233445566778899aabbccddeeff_01"],
  surface_id: "surface_00112233445566778899aabbccddeeff",
});

function closedBobRun({
  artifacts = [{ ...report }],
  claims = {},
  ...overrides
} = {}) {
  return {
    artifacts,
    artifact_snapshot_root: "artifacts",
    artifact_tree_sha256: sha256(canonicalJson(artifacts)),
    case_id: "fx_0123456789abcdef0123456789abcdef",
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
      ...claims,
    },
    confidentiality: "controller-only",
    controller_commit: "b".repeat(40),
    lane: "bob-qa",
    node_version: "v24.0.0",
    qualification: "not-evidence",
    result: null,
    run_id: "run_0123456789abcdef0123456789abcdef",
    schema_version: 1,
    subject_commit: "c".repeat(40),
    suite_id: "bob-evaluation-v1",
    verification_status: "unverified",
    workspace_tree_sha256: "d".repeat(64),
    ...overrides,
  };
}

function suite() {
  const otherCaseId = "fx_fedcba9876543210fedcba9876543210";
  return {
    cases: [
      {
        fixture_manifest:
          "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/fixture-manifest.json",
        id: "fx_0123456789abcdef0123456789abcdef",
        oracle_commitments: [
          `seal_${"1".repeat(64)}`,
          `seal_${"2".repeat(64)}`,
        ],
        qa_context:
          "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/qa-context.md",
        report_identifiers: reportIdentifiers,
        smoke_checks: ["check_primary"],
      },
      {
        fixture_manifest:
          `tests/evaluation/fixtures/${otherCaseId}/fixture-manifest.json`,
        id: otherCaseId,
        oracle_commitments: [
          `seal_${"3".repeat(64)}`,
          `seal_${"4".repeat(64)}`,
        ],
        qa_context:
          `tests/evaluation/fixtures/${otherCaseId}/qa-context.md`,
        report_identifiers: {
          core_flow_ids: [
            "flow_ffeeddccbbaa99887766554433221100_01",
          ],
          surface_id: "surface_ffeeddccbbaa99887766554433221100",
        },
        smoke_checks: ["check_primary"],
      },
    ],
    id: "bob-evaluation-v1",
    lane: "bob-qa",
    schema_version: 1,
  };
}

function laneResult(overrides = {}) {
  return {
    blocking_evidence: [],
    checklist: [],
    findings: [],
    flows: [
      {
        core: true,
        effectiveness: true,
        evidence: [
          {
            kind: "report-reference",
            path: report.path,
          },
        ],
        finding_ids: [],
        id: reportIdentifiers.core_flow_ids[0],
        state: "Pass",
      },
    ],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: {
        S1: 0,
        S2: 0,
        S3: 0,
        S4: 0,
      },
      state: "Go",
    },
    ...overrides,
  };
}

async function hostTranscript(taskOverrides = {}) {
  const baseReportOutput = {
    lane_result: laneResult(),
    report: {
      path: report.path,
      sha256: report.sha256,
    },
  };
  const reportOutput = {
    ...baseReportOutput,
    ...taskOverrides.report_output,
  };
  const taskOutput = {
    ...taskOverrides,
    report_output: reportOutput,
    results:
      taskOverrides.results ??
      [
        {
          control_ids: ["control_primary"],
          disposition: "exercised",
          evidence_sha256: sha256(
            canonicalJson(reportOutput.lane_result.flows[0].evidence),
          ),
          flow_id: reportIdentifiers.core_flow_ids[0],
          task_id: "task_primary",
        },
      ],
  };
  const outputs = [
    {
      surfaces: [
        {
          control_ids: ["control_primary"],
          id: "surface_primary",
        },
      ],
    },
    {
      tasks: [
        {
          control_ids: ["control_primary"],
          id: "task_primary",
          parent_task_id: null,
          surface_id: "surface_primary",
        },
      ],
    },
    taskOutput,
  ];
  let index = 0;
  return executePreparedBobCase({
    adapter: {
      async runPhase() {
        const output = outputs[index];
        index += 1;
        return output;
      },
    },
    dispatchId: "dispatch_0123456789abcdef0123456789abcdef",
    preparation: {
      case_id: "fx_0123456789abcdef0123456789abcdef",
      controller_commit: "b".repeat(40),
      lane: "bob-qa",
      qualification: "not-evidence",
      result: null,
      run_id: "run_0123456789abcdef0123456789abcdef",
      schema_version: 1,
      subject_commit: "c".repeat(40),
      suite_id: "bob-evaluation-v1",
      verification_status: "unverified",
    },
    suite: suite(),
  });
}

test("binds exactly one closed Bob report without reading or parsing it", () => {
  const closure = closedBobRun();

  const binding = bindClosedBobReport({ closure });

  assert.equal(validateClosedBobReportBinding(binding), binding);
  assert.equal(binding.verification_status, "unverified");
  assert.equal(binding.qualification, "not-evidence");
  assert.equal(binding.result, null);
  assert.deepEqual(binding.binding.report, report);
  assert.equal(binding.binding.closure_sha256, sha256(canonicalJson(closure)));
  assert.equal(
    binding.binding_sha256,
    sha256(canonicalJson(binding.binding)),
  );
  assert.deepEqual(binding.claims, {
    artifact_inventory: "closed",
    report_content: "not-read",
    report_semantics: "not-attested",
    report_structure: "not-parsed",
    state_authentication: "not-attested",
  });
  assert.equal(Object.hasOwn(binding, "verdict"), false);
  assert.equal(Object.hasOwn(binding, "score"), false);
  assert.equal(Object.hasOwn(binding, "normalized_case"), false);
});

for (const [name, closure, message] of [
  [
    "a non-Bob lane",
    closedBobRun({ lane: "regression-qa" }),
    /lane must equal bob-qa/u,
  ],
  [
    "promoted verification",
    closedBobRun({ verification_status: "verified" }),
    /must remain non-qualifying/u,
  ],
  [
    "promoted qualification",
    closedBobRun({ qualification: "evidence" }),
    /must remain non-qualifying/u,
  ],
  [
    "a promoted result",
    closedBobRun({ result: {} }),
    /must remain non-qualifying/u,
  ],
  [
    "an open artifact inventory",
    closedBobRun({ claims: { artifact_inventory: "not-closed" } }),
    /artifact_inventory must equal closed/u,
  ],
  [
    "the wrong snapshot root",
    closedBobRun({ artifact_snapshot_root: "lane" }),
    /artifact_snapshot_root must equal artifacts/u,
  ],
  [
    "no canonical Bob report",
    closedBobRun({
      artifacts: [
        {
          ...report,
          path: "QA/2026-07-28-0415-regression-qa-primary-surface.md",
        },
      ],
    }),
    /exactly one canonical Bob report/u,
  ],
  [
    "a malformed Bob report name",
    closedBobRun({
      artifacts: [
        {
          ...report,
          path: "QA/2026-07-28-0415-bob-qa-.md",
        },
      ],
    }),
    /exactly one canonical Bob report/u,
  ],
  [
    "an impossible Bob report date",
    closedBobRun({
      artifacts: [
        {
          ...report,
          path: "QA/2026-02-30-0415-bob-qa-primary-surface.md",
        },
      ],
    }),
    /exactly one canonical Bob report/u,
  ],
  [
    "an impossible Bob report time",
    closedBobRun({
      artifacts: [
        {
          ...report,
          path: "QA/2026-07-28-2460-bob-qa-primary-surface.md",
        },
      ],
    }),
    /exactly one canonical Bob report/u,
  ],
  [
    "multiple canonical Bob reports",
    closedBobRun({
      artifacts: [
        { ...report },
        {
          ...report,
          path: "QA/2026-07-28-0416-bob-qa-secondary-surface.md",
          sha256: "e".repeat(64),
        },
      ],
    }),
    /exactly one canonical Bob report/u,
  ],
  [
    "an unsafe artifact path",
    closedBobRun({
      artifacts: [{ ...report, path: "../2026-07-28-0415-bob-qa-scope.md" }],
    }),
    /normalized repository-relative path/u,
  ],
  [
    "a writable captured mode",
    closedBobRun({ artifacts: [{ ...report, mode: "0600" }] }),
    /mode must equal 0400/u,
  ],
  [
    "an invalid artifact digest",
    closedBobRun({ artifacts: [{ ...report, sha256: "invalid" }] }),
    /sha256 has an invalid value/u,
  ],
  [
    "an invalid artifact size",
    closedBobRun({ artifacts: [{ ...report, size: -1 }] }),
    /non-negative safe integer/u,
  ],
  [
    "duplicate artifact paths",
    closedBobRun({
      artifacts: [{ ...report }, { ...report, sha256: "e".repeat(64) }],
    }),
    /unique values/u,
  ],
  [
    "unsorted artifact paths",
    closedBobRun({
      artifacts: [
        { ...report, path: "QA/z.log" },
        { ...report },
      ],
    }),
    /ordered by path/u,
  ],
  [
    "an extra closure field",
    { ...closedBobRun(), adapter_output: {} },
    /closed Bob run fields/u,
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => bindClosedBobReport({ closure }), message);
  });
}

test("canonical snapshot rejects sparse entries and drops named properties", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => bindClosedBobReport({ closure: closedBobRun({ artifacts: sparse }) }),
    /must be dense|must be an object/u,
  );

  const named = [{ ...report }];
  named.role = "adversarial";
  assert.deepEqual(
    bindClosedBobReport({
      closure: closedBobRun({ artifacts: named }),
    }).binding.report,
    report,
  );
});

test("rejects an artifact-tree digest that does not bind the inventory", () => {
  assert.throws(
    () =>
      bindClosedBobReport({
        closure: closedBobRun({ artifact_tree_sha256: "f".repeat(64) }),
      }),
    /artifact_tree_sha256 does not match/u,
  );
});

test("snapshots accessor-backed closure data exactly once before validation", () => {
  const primaryReport = { ...report };
  const substitutedReport = {
    ...report,
    path: "QA/2026-07-28-0416-bob-qa-substituted-surface.md",
    sha256: "e".repeat(64),
  };
  let reads = 0;
  const artifacts = [];
  Object.defineProperty(artifacts, "0", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 6 ? substitutedReport : primaryReport;
    },
  });
  artifacts.length = 1;
  const closure = closedBobRun({ artifacts });
  closure.artifact_tree_sha256 = sha256(canonicalJson([primaryReport]));
  reads = 0;

  const binding = bindClosedBobReport({ closure });
  assert.deepEqual(binding.binding.report, primaryReport);
  assert.equal(reads, 1);
});

test("binding validation rejects tampering and semantic additions", () => {
  const binding = bindClosedBobReport({ closure: closedBobRun() });

  assert.throws(
    () =>
      validateClosedBobReportBinding({
        ...binding,
        binding: {
          ...binding.binding,
          case_id: "fx_fedcba9876543210fedcba9876543210",
        },
      }),
    /binding_sha256 does not match/u,
  );
  assert.throws(
    () =>
      validateClosedBobReportBinding({
        ...binding,
        claims: { ...binding.claims, report_semantics: "parsed" },
      }),
    /report_semantics must equal not-attested/u,
  );
  assert.throws(
    () =>
      validateClosedBobReportBinding({
        ...binding,
        verdict: "Go",
      }),
    /closed Bob report binding fields/u,
  );
  assert.throws(
    () =>
      validateClosedBobReportBinding({
        ...binding,
        binding: {
          ...binding.binding,
          report: { ...binding.binding.report, content: "Go" },
        },
      }),
    /binding\.report fields/u,
  );
});

test("joins the closed report to the controller-hashed lane result", async () => {
  const transcript = await hostTranscript();
  const adaptation = adaptClosedBobHostResult({
    closure: closedBobRun(),
    suite: suite(),
    transcript,
  });

  assert.equal(
    validateClosedBobReportAdaptation(adaptation),
    adaptation,
  );
  assert.equal(adaptation.verification_status, "unverified");
  assert.equal(adaptation.qualification, "not-evidence");
  assert.equal(adaptation.result, null);
  assert.deepEqual(
    adaptation.adaptation.report_identifiers,
    reportIdentifiers,
  );
  assert.deepEqual(
    adaptation.adaptation.lane_result,
    laneResult(),
  );
  assert.deepEqual(adaptation.claims, {
    artifact_inventory: "closed",
    evidence_inventory: "closed",
    method_order: "not-attested",
    report_content: "not-read",
    report_semantic_parity: "not-attested",
    state_authentication: "not-attested",
    structured_lane_result: "validated",
  });
});

test("closed adaptation rejects report, identity, and evidence substitution", async () => {
  const transcript = await hostTranscript();
  const wrongReport = await hostTranscript({
    report_output: {
      report: {
        path: report.path,
        sha256: "f".repeat(64),
      },
    },
  });
  assert.throws(
    () =>
      adaptClosedBobHostResult({
        closure: closedBobRun(),
        suite: suite(),
        transcript: wrongReport,
      }),
    /report path and digest do not match/u,
  );

  assert.throws(
    () =>
      adaptClosedBobHostResult({
        closure: closedBobRun({
          run_id: "run_fedcba9876543210fedcba9876543210",
        }),
        suite: suite(),
        transcript,
      }),
    /run_id does not match/u,
  );

  const unclosedEvidence = await hostTranscript({
    report_output: {
      lane_result: laneResult({
        flows: [
          {
            ...laneResult().flows[0],
            evidence: [
              {
                kind: "screenshot",
                path: "QA/evidence/missing.png",
              },
            ],
          },
        ],
      }),
    },
  });
  assert.throws(
    () =>
      adaptClosedBobHostResult({
        closure: closedBobRun(),
        suite: suite(),
        transcript: unclosedEvidence,
      }),
    /evidence is absent from the closed artifact inventory/u,
  );
});

test("adaptation digest rejects schema-valid semantic tampering", async () => {
  const adaptation = adaptClosedBobHostResult({
    closure: closedBobRun(),
    suite: suite(),
    transcript: await hostTranscript(),
  });
  const tampered = structuredClone(adaptation);
  tampered.adaptation.lane_result.flows[0].state = "Fail";
  tampered.adaptation.lane_result.flows[0].effectiveness = false;
  tampered.adaptation.lane_result.verdict.state = "No-Go";

  assert.throws(
    () => validateClosedBobReportAdaptation(tampered),
    /adaptation_sha256 does not match/u,
  );

  const rebound = structuredClone(adaptation);
  rebound.binding.report_sha256 = "f".repeat(64);
  assert.throws(
    () => validateClosedBobReportAdaptation(rebound),
    /binding_sha256 does not match/u,
  );
});
