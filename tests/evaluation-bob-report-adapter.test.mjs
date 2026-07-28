import assert from "node:assert/strict";
import { test } from "node:test";
import { bindClosedBobReport } from "../scripts/evaluation/bob-report-adapter.mjs";
import {
  canonicalJson,
  sha256,
  validateClosedBobReportBinding,
} from "../scripts/evaluation/contracts.mjs";

const report = Object.freeze({
  mode: "0400",
  path: "QA/2026-07-28-0415-bob-qa-primary-surface.md",
  sha256: "a".repeat(64),
  size: 123,
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

test("rejects sparse and named artifact arrays", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => bindClosedBobReport({ closure: closedBobRun({ artifacts: sparse }) }),
    /must be dense/u,
  );

  const named = [{ ...report }];
  named.role = "adversarial";
  assert.throws(
    () => bindClosedBobReport({ closure: closedBobRun({ artifacts: named }) }),
    /must not contain named properties/u,
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

test("snapshots accessor-backed closure data before binding identities", () => {
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

  assert.throws(
    () => bindClosedBobReport({ closure }),
    /artifact_tree_sha256 does not match/u,
  );
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
