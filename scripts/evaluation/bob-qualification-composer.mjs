import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { adaptClosedBobHostResult } from "./bob-report-adapter.mjs";
import { validateBobHostExecution } from "./bob-host-executor.mjs";
import { requestsFromBobHostTranscript } from "./bob-host-protocol.mjs";
import {
  codexSessionChainSha256,
  validateCodexSessionChain,
} from "./codex-session-chain.mjs";
import {
  canonicalJson,
  parseContractJson,
  sha256,
  validateClosedCaseRun,
  validateNormalizedCase,
  validateOracleSet,
  validateSuite,
} from "./contracts.mjs";
import { previewCase } from "./scoring.mjs";

const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const LIVE_CLAIMS = Object.freeze({
  authenticated_client_login:
    "controller-bound-chatgpt-status-observation-only",
  controller_state_chain: "ed25519-key-continuity-verified",
  provider_authentication: "not-attested",
  report_semantics: "not-attested",
  sandbox_qualification: "not-attested",
});
const MAX_RETAINED_RECORD_BYTES = 32 * 1024 * 1024;
const CLAIMS = Object.freeze({
  artifact_inventory: "declared-closed-artifacts-reread",
  authenticated_client_login:
    "controller-bound-chatgpt-status-observation-only",
  controller_state_chain: "ed25519-key-continuity-verified",
  evidence_inventory: "closed",
  gateway_bindings: "signed-digest-references-only",
  literal_confidential_value_scan:
    "closed-artifacts-and-retained-records-passed",
  normalized_case: "validated",
  owned_process_groups: "proven-empty",
  phase_order: "controller-observed-inventory-model-task",
  provider_authentication: "not-attested",
  report_semantic_parity: "not-attested",
  sandbox_qualification: "not-attested",
  semantic_fixture_opacity: "not-attested",
  smoke_gate_provenance: "not-attested",
  state_authentication: "not-attested",
  retained_records: "closure-live-session-chain-reread",
  structured_lane_result: "validated",
});

function snapshot(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
  return parseContractJson(canonicalJson(value), label);
}

function assertNonqualifying(value, label) {
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error(`${label} must remain explicitly non-qualifying`);
  }
}

function assertEqual(left, right, label) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(`${label} does not match its authority`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

async function readRetainedRecord(path, label) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path
  ) {
    throw new Error(`${label} path must be normalized and absolute`);
  }
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > MAX_RETAINED_RECORD_BYTES ||
    (before.mode & 0o777) !== 0o600 ||
    await realpath(path) !== path
  ) {
    throw new Error(`${label} must be a retained mode-600 file`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    bytes.length !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size
  ) {
    throw new Error(`${label} changed while it was read`);
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = parseContractJson(source, label);
  if (source !== canonicalJson(value)) {
    throw new Error(`${label} must use canonical JSON`);
  }
  return { bytes, value };
}

function validateComposition(composition, execution, report, chain) {
  assertNonqualifying(composition, "live composition");
  const unsigned = { ...composition };
  delete unsigned.composition_sha256;
  if (
    composition.composition_observation !==
      "three-atomic-phase-records-bound" ||
    composition.composition_sha256 !== sha256(canonicalJson(unsigned)) ||
    composition.bob_host_binding_sha256 !==
      sha256(canonicalJson(execution.transcript.binding)) ||
    composition.event_chain_sha256 !==
      execution.transcript.event_chain_sha256 ||
    composition.transcript_sha256 !==
      sha256(canonicalJson(execution.transcript)) ||
    composition.report_sha256 !== report.sha256 ||
    !Array.isArray(composition.atomic_receipt_sha256s) ||
    composition.atomic_receipt_sha256s.length !== PHASES.length ||
    !Array.isArray(composition.thread_ids) ||
    composition.thread_ids.length !== PHASES.length ||
    new Set(composition.thread_ids).size !== PHASES.length
  ) {
    throw new Error("live composition does not match the host execution");
  }
  composition.atomic_receipt_sha256s.forEach((value, index) =>
    assertDigest(value, `live composition atomic receipt[${index}]`)
  );

  const requests = requestsFromBobHostTranscript(execution.transcript);
  chain.transitions.forEach(({ transition }, index) => {
    const phase = PHASES[index];
    if (
      transition.phase !== phase ||
      transition.atomic_receipt_sha256 !==
        composition.atomic_receipt_sha256s[index] ||
      transition.thread_id !== composition.thread_ids[index] ||
      transition.request_sha256 !==
        sha256(canonicalJson(requests[index])) ||
      transition.output_sha256 !==
        sha256(canonicalJson(execution.transcript.outputs[phase])) ||
      transition.process_receipt_sha256 !==
        sha256(canonicalJson(execution.process_receipts[index]))
    ) {
      throw new Error("signed session transition does not match host execution");
    }
  });
}

async function validateLiveSession(value) {
  const live = snapshot(value, "live session");
  assertNonqualifying(live, "live session");
  const execution = validateBobHostExecution(live.execution);
  const chain = validateCodexSessionChain(live.session_chain);
  const report = live.report;
  if (
    !Number.isSafeInteger(report?.bytes) ||
    report.bytes < 1 ||
    typeof report.path !== "string"
  ) {
    throw new Error("live report metadata is invalid");
  }
  assertDigest(report.sha256, "live report digest");
  validateComposition(live.composition, execution, report, chain);

  const record = live.live_record;
  assertNonqualifying(record, "live session record");
  assertEqual(record.claims, LIVE_CLAIMS, "live session claims");
  const unsignedRecord = { ...record };
  delete unsignedRecord.live_record_sha256;
  if (
    record.live_record_sha256 !== sha256(canonicalJson(unsignedRecord)) ||
    record.session_chain_sha256 !== codexSessionChainSha256(chain)
  ) {
    throw new Error("live session record digest does not match");
  }
  for (const [name, expected] of [
    ["composition", live.composition],
    ["execution", execution],
    ["report", report],
    ["session_chain", chain],
  ]) {
    assertEqual(record[name], expected, `live session record ${name}`);
  }
  const stateRoot = live.controller_state_directory;
  const stateMetadata = await lstat(stateRoot);
  if (
    !isAbsolute(stateRoot) ||
    resolve(stateRoot) !== stateRoot ||
    !stateMetadata.isDirectory() ||
    stateMetadata.isSymbolicLink() ||
    (stateMetadata.mode & 0o777) !== 0o700 ||
    await realpath(stateRoot) !== stateRoot ||
    live.live_record_path !== join(stateRoot, "live-session.json") ||
    live.session_chain_path !== join(stateRoot, "session-chain.json")
  ) {
    throw new Error("live session retained paths are invalid");
  }
  const retainedRecord = await readRetainedRecord(
    live.live_record_path,
    "retained live session",
  );
  const retainedChain = await readRetainedRecord(
    live.session_chain_path,
    "retained session chain",
  );
  assertEqual(retainedRecord.value, record, "retained live session");
  assertEqual(retainedChain.value, chain, "retained session chain");
  return {
    chain,
    execution,
    live,
    report,
    retainedSources: [retainedRecord.bytes, retainedChain.bytes],
  };
}

function confidentialValues(oracles, suite, selectedCaseId) {
  return [
    ...oracles.flatMap((oracle) => [
      oracle.pair_id,
      oracle.canary_token,
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    ]),
    ...suite.cases
      .filter(({ id }) => id !== selectedCaseId)
      .map(({ id }) => id),
  ];
}

async function readClosedArtifacts(snapshotRoot, artifacts) {
  if (
    typeof snapshotRoot !== "string" ||
    !isAbsolute(snapshotRoot) ||
    resolve(snapshotRoot) !== snapshotRoot
  ) {
    throw new Error("artifact snapshot path must be normalized and absolute");
  }
  const rootMetadata = await lstat(snapshotRoot);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (rootMetadata.mode & 0o777) !== 0o500 ||
    await realpath(snapshotRoot) !== snapshotRoot
  ) {
    throw new Error("artifact snapshot must be a retained mode-500 directory");
  }
  const sources = [];
  for (const artifact of artifacts) {
    const path = resolve(snapshotRoot, artifact.path);
    const selected = relative(snapshotRoot, path);
    if (
      selected === "" ||
      selected === ".." ||
      selected.startsWith("../") ||
      isAbsolute(selected)
    ) {
      throw new Error("closed artifact escaped the snapshot");
    }
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o400 ||
      await realpath(path) !== path
    ) {
      throw new Error("closed artifact is not a standalone mode-400 file");
    }
    const bytes = await readFile(path);
    const after = await lstat(path);
    if (
      bytes.length !== artifact.size ||
      sha256(bytes) !== artifact.sha256 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    ) {
      throw new Error("closed artifact bytes do not match the closure");
    }
    sources.push(bytes);
  }
  return sources;
}

function scanForLeaks(sources, values) {
  const tokens = [...new Set(values)].map((value) =>
    Buffer.from(value, "utf8")
  );
  if (sources.some((source) => tokens.some((token) => source.includes(token)))) {
    throw new Error("closed output contains a confidential controller value");
  }
}

export async function composeClosedCodexBobEvaluation({
  closedRun,
  liveSession,
  oracleSet,
  smokeGate,
  suite,
}) {
  const selectedSuite = snapshot(suite, "Bob suite");
  validateSuite(selectedSuite);
  if (selectedSuite.lane !== "bob-qa") {
    throw new Error("qualification composer supports only bob-qa");
  }
  const oracles = snapshot({ values: oracleSet }, "sealed oracle set").values;
  validateOracleSet(oracles, selectedSuite);
  const selectedSmokeGate = snapshot(
    smokeGate,
    "caller-supplied smoke gate",
  );
  const selectedClosedRun = snapshot(closedRun, "closed runner result");
  const closure = validateClosedCaseRun(selectedClosedRun.closure);
  if (
    typeof selectedClosedRun.closed_path !== "string" ||
    selectedClosedRun.closed_path !==
      join(dirname(selectedClosedRun.closed_path), "closed.json") ||
    selectedClosedRun.artifact_snapshot_path !==
      join(dirname(selectedClosedRun.closed_path), "artifacts")
  ) {
    throw new Error("closed runner retained paths are invalid");
  }
  const retainedClosure = await readRetainedRecord(
    selectedClosedRun.closed_path,
    "retained closed run",
  );
  assertEqual(retainedClosure.value, closure, "retained closed run");
  const live = await validateLiveSession(liveSession);
  const binding = live.execution.transcript.binding;
  for (const [name, expected] of Object.entries({
    case_id: closure.case_id,
    controller_commit: closure.controller_commit,
    run_id: closure.run_id,
    subject_commit: closure.subject_commit,
    suite_id: closure.suite_id,
  })) {
    if (binding[name] !== expected) {
      throw new Error(`live host ${name} does not match the closed run`);
    }
  }

  const adaptation = adaptClosedBobHostResult({
    closure,
    suite: selectedSuite,
    transcript: live.execution.transcript,
  });
  const reportArtifact = closure.artifacts.find(
    ({ path }) => path === live.report.path,
  );
  if (
    reportArtifact === undefined ||
    reportArtifact.sha256 !== live.report.sha256 ||
    reportArtifact.size !== live.report.bytes
  ) {
    throw new Error("live report does not match the closed artifact");
  }

  const normalizedCase = {
    case_id: adaptation.adaptation.case_id,
    completion_status: adaptation.adaptation.completion_status,
    lane: adaptation.adaptation.lane,
    lane_result: structuredClone(adaptation.adaptation.lane_result),
    schema_version: 1,
    smoke_gate: selectedSmokeGate,
    subject_commit: adaptation.adaptation.subject_commit,
  };
  validateNormalizedCase(normalizedCase, selectedSuite);
  const suiteCase = selectedSuite.cases.find(
    ({ id }) => id === normalizedCase.case_id,
  );
  const oracle = oracles.find(
    ({ case_id: caseId }) => caseId === normalizedCase.case_id,
  );
  const preview = previewCase({
    normalizedCase,
    oracle,
    suite: selectedSuite,
    suiteCase,
  });

  const artifactSources = await readClosedArtifacts(
    selectedClosedRun.artifact_snapshot_path,
    closure.artifacts,
  );
  scanForLeaks(
    [
      ...artifactSources,
      retainedClosure.bytes,
      ...live.retainedSources,
      Buffer.from(canonicalJson(selectedSmokeGate), "utf8"),
    ],
    confidentialValues(oracles, selectedSuite, normalizedCase.case_id),
  );

  const compositionBinding = {
    adaptation_sha256: sha256(canonicalJson(adaptation)),
    closure_sha256: sha256(canonicalJson(closure)),
    live_record_sha256: live.live.live_record.live_record_sha256,
    normalized_case_sha256: sha256(canonicalJson(normalizedCase)),
    oracle_sha256: sha256(canonicalJson(oracle)),
    preview_sha256: sha256(canonicalJson(preview)),
    session_chain_sha256: codexSessionChainSha256(live.chain),
    smoke_gate_sha256: sha256(canonicalJson(selectedSmokeGate)),
    suite_sha256: sha256(canonicalJson(selectedSuite)),
  };
  return {
    adaptation,
    binding: compositionBinding,
    binding_sha256: sha256(canonicalJson(compositionBinding)),
    claims: structuredClone(CLAIMS),
    confidentiality: "controller-secret",
    normalized_case: normalizedCase,
    observation: "closed-codex-bob-evaluation-composed",
    preview,
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
}
