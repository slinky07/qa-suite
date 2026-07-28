import {
  canonicalJson,
  isCanonicalBobReportPath,
  parseContractJson,
  sha256,
  validateClosedBobReportAdaptation,
  validateClosedBobReportBinding,
  validateClosedCaseRun,
  validateSuite,
} from "./contracts.mjs";
import {
  validateBobHostTranscript,
} from "./bob-host-protocol.mjs";

function snapshotValidated(value, label, validator) {
  const snapshot = parseContractJson(
    canonicalJson(value),
    label,
  );
  return validator(snapshot, label);
}

function snapshotClosedRun(closure) {
  return snapshotValidated(
    closure,
    "closed Bob run",
    validateClosedCaseRun,
  );
}

function laneResultEvidencePaths(laneResult) {
  return [
    ...laneResult.blocking_evidence,
    ...laneResult.checklist.flatMap(({ evidence }) => evidence),
    ...laneResult.findings.flatMap(({ evidence }) => evidence),
    ...laneResult.flows.flatMap(({ evidence }) => evidence),
    ...laneResult.observations.flatMap(({ evidence }) => evidence),
  ].map(({ path }) => path);
}

export function bindClosedBobReport({ closure }) {
  const closed = snapshotClosedRun(closure);
  if (closed.lane !== "bob-qa") {
    throw new Error("closed Bob run.lane must equal bob-qa");
  }
  const reports = closed.artifacts.filter(({ path }) =>
    isCanonicalBobReportPath(path),
  );
  if (reports.length !== 1) {
    throw new Error(
      "closed Bob run must contain exactly one canonical Bob report",
    );
  }
  const binding = {
    artifact_snapshot_root: closed.artifact_snapshot_root,
    artifact_tree_sha256: closed.artifact_tree_sha256,
    case_id: closed.case_id,
    closure_sha256: sha256(canonicalJson(closed)),
    controller_commit: closed.controller_commit,
    lane: closed.lane,
    report: { ...reports[0] },
    run_id: closed.run_id,
    subject_commit: closed.subject_commit,
    suite_id: closed.suite_id,
    workspace_tree_sha256: closed.workspace_tree_sha256,
  };
  return validateClosedBobReportBinding({
    binding,
    binding_sha256: sha256(canonicalJson(binding)),
    claims: {
      artifact_inventory: "closed",
      report_content: "not-read",
      report_semantics: "not-attested",
      report_structure: "not-parsed",
      state_authentication: "not-attested",
    },
    confidentiality: "controller-only",
    observation: "closed-bob-report-bound",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  });
}

export function adaptClosedBobHostResult({
  closure,
  suite,
  transcript,
}) {
  const closed = snapshotClosedRun(closure);
  const suiteSnapshot = snapshotValidated(
    suite,
    "Bob suite",
    validateSuite,
  );
  const transcriptSnapshot = snapshotValidated(
    transcript,
    "Bob host transcript",
    (value) => validateBobHostTranscript(value),
  );
  const reportBinding = bindClosedBobReport({ closure: closed });
  if (
    suiteSnapshot.id !== closed.suite_id ||
    suiteSnapshot.lane !== "bob-qa"
  ) {
    throw new Error("Bob suite does not match the closed run");
  }
  const suiteCase = suiteSnapshot.cases.find(
    ({ id }) => id === closed.case_id,
  );
  if (suiteCase === undefined) {
    throw new Error("Bob suite does not contain the closed case");
  }
  const hostBinding = transcriptSnapshot.binding;
  for (const [name, expected] of Object.entries({
    case_id: closed.case_id,
    controller_commit: closed.controller_commit,
    run_id: closed.run_id,
    subject_commit: closed.subject_commit,
    suite_id: closed.suite_id,
  })) {
    if (hostBinding[name] !== expected) {
      throw new Error(`Bob host transcript ${name} does not match closure`);
    }
  }
  if (
    canonicalJson(hostBinding.report_identifiers) !==
    canonicalJson(suiteCase.report_identifiers)
  ) {
    throw new Error(
      "Bob host transcript report identifiers do not match the suite case",
    );
  }
  const reportOutput =
    transcriptSnapshot.outputs.task_execution.report_output;
  if (
    reportOutput.report.path !== reportBinding.binding.report.path ||
    reportOutput.report.sha256 !== reportBinding.binding.report.sha256
  ) {
    throw new Error(
      "Bob host report path and digest do not match the closed report",
    );
  }
  const artifactPaths = new Set(
    closed.artifacts.map(({ path }) => path),
  );
  const unclosedEvidence = laneResultEvidencePaths(
    reportOutput.lane_result,
  ).find((path) => !artifactPaths.has(path));
  if (unclosedEvidence !== undefined) {
    throw new Error(
      "Bob host lane-result evidence is absent from the closed artifact inventory",
    );
  }
  const adaptation = {
    case_id: closed.case_id,
    completion_status:
      reportOutput.lane_result.verdict.state === "Blocked"
        ? "lane-blocked"
        : "completed",
    lane: "bob-qa",
    lane_result: structuredClone(reportOutput.lane_result),
    report_identifiers: structuredClone(
      suiteCase.report_identifiers,
    ),
    subject_commit: closed.subject_commit,
    suite_id: closed.suite_id,
  };
  const binding = {
    adaptation_sha256: sha256(canonicalJson(adaptation)),
    closed_report_binding_sha256: sha256(
      canonicalJson(reportBinding),
    ),
    host_transcript_sha256: sha256(
      canonicalJson(transcriptSnapshot),
    ),
    report_sha256: reportBinding.binding.report.sha256,
  };
  return validateClosedBobReportAdaptation({
    adaptation,
    binding,
    binding_sha256: sha256(canonicalJson(binding)),
    claims: {
      artifact_inventory: "closed",
      evidence_inventory: "closed",
      method_order: "not-attested",
      report_content: "not-read",
      report_semantic_parity: "not-attested",
      state_authentication: "not-attested",
      structured_lane_result: "validated",
    },
    confidentiality: "controller-only",
    observation: "closed-bob-host-result-adapted",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  });
}
