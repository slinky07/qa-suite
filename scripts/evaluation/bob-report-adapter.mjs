import {
  canonicalJson,
  isCanonicalBobReportPath,
  parseContractJson,
  sha256,
  validateClosedBobReportBinding,
  validateClosedCaseRun,
} from "./contracts.mjs";

function snapshotClosedRun(closure) {
  validateClosedCaseRun(closure, "closed Bob run");
  const snapshot = parseContractJson(
    canonicalJson(closure),
    "closed Bob run",
  );
  return validateClosedCaseRun(snapshot, "closed Bob run");
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
