import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  composeClosedCodexBobEvaluation,
} from "../scripts/evaluation/bob-qualification-composer.mjs";
import {
  executePreparedBobCase,
  requestsFromBobHostTranscript,
} from "../scripts/evaluation/bob-host-protocol.mjs";
import {
  codexSessionChainSha256,
  createCodexSessionChainSigner,
} from "../scripts/evaluation/codex-session-chain.mjs";
import {
  canonicalJson,
  parseContractJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const suite = parseContractJson(
  await readFile(
    new URL("evaluation/suites/bob-evaluation-v1.json", import.meta.url),
    "utf8",
  ),
  "committed Bob suite",
);
const oracles = parseContractJson(
  await readFile(
    new URL("evaluation/oracles/bob-evaluation-v1.json", import.meta.url),
    "utf8",
  ),
  "committed Bob oracles",
);
const selectedCase = suite.cases[1];
const reportPath = "QA/2026-07-29-1200-bob-qa-control.md";
const evidencePath = "QA/evidence/control-flow.png";
const runId = "run_0123456789abcdef0123456789abcdef";
const dispatchId = "dispatch_0123456789abcdef0123456789abcdef";
const controllerCommit = "b".repeat(40);
const subjectCommit = "c".repeat(40);
const phases = [
  "interface_inventory",
  "expected_use_model",
  "task_execution",
];

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function preparation() {
  return {
    case_id: selectedCase.id,
    controller_commit: controllerCommit,
    lane: "bob-qa",
    qualification: "not-evidence",
    result: null,
    run_id: runId,
    schema_version: 1,
    subject_commit: subjectCommit,
    suite_id: suite.id,
    verification_status: "unverified",
  };
}

function laneResult() {
  return {
    blocking_evidence: [],
    checklist: [],
    findings: [],
    flows: selectedCase.report_identifiers.core_flow_ids.map((id) => ({
      core: true,
      effectiveness: true,
      evidence: [{ kind: "screenshot", path: evidencePath }],
      finding_ids: [],
      id,
      state: "Pass",
    })),
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: { S1: 0, S2: 0, S3: 0, S4: 0 },
      state: "Go",
    },
  };
}

async function makeTranscript(reportSha256) {
  const result = laneResult();
  const outputs = [
    {
      surfaces: [{
        control_ids: ["control_primary"],
        id: "surface_primary",
      }],
    },
    {
      tasks: selectedCase.report_identifiers.core_flow_ids.map((_, index) => ({
        control_ids: ["control_primary"],
        id: `task_${index + 1}`,
        parent_task_id: null,
        surface_id: "surface_primary",
      })),
    },
    {
      report_output: {
        lane_result: result,
        report: { path: reportPath, sha256: reportSha256 },
      },
      results: result.flows.map((flow, index) => ({
        control_ids: ["control_primary"],
        disposition: "exercised",
        evidence_sha256: sha256(canonicalJson(flow.evidence)),
        flow_id: flow.id,
        task_id: `task_${index + 1}`,
      })),
    },
  ];
  let index = 0;
  return executePreparedBobCase({
    adapter: {
      async runPhase() {
        return outputs[index++];
      },
    },
    dispatchId,
    preparation: preparation(),
    suite,
  });
}

function makeExecution(transcript) {
  const requests = requestsFromBobHostTranscript(transcript);
  const processReceipts = requests.map((request) => {
    const requestSha256 = sha256(canonicalJson(request));
    const response = Buffer.from(canonicalJson({
      output: transcript.outputs[request.phase],
      phase: request.phase,
      request_sha256: requestSha256,
      schema_version: 1,
    }));
    return {
      owned_process_group: "proven-empty",
      output_sha256: sha256(canonicalJson(transcript.outputs[request.phase])),
      phase: request.phase,
      request_sha256: requestSha256,
      response_bytes: response.length,
      response_sha256: sha256(response),
      stderr_bytes: 0,
      stderr_sha256: sha256(Buffer.alloc(0)),
    };
  });
  const unsigned = {
    execution_observation:
      "three-supervised-process-groups-completed-and-emptied",
    policy_sha256: digest("executor policy"),
    process_receipts: processReceipts,
    program: {
      arguments_sha256: digest("arguments"),
      executable_sha256: digest("executable"),
      support_files_sha256: digest("support"),
    },
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    transcript,
    verification_status: "unverified",
  };
  return {
    ...unsigned,
    execution_sha256: sha256(canonicalJson(unsigned)),
  };
}

async function makeLiveSession(execution, report, stateRoot) {
  const requests = requestsFromBobHostTranscript(execution.transcript);
  const signer = createCodexSessionChainSigner();
  const atomicReceiptSha256s = phases.map((phase) =>
    digest(`${phase}:atomic`)
  );
  const threadIds = phases.map(
    (_, index) =>
      `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
  );
  phases.forEach((phase, index) => signer.appendTransition({
    atomic_receipt_sha256: atomicReceiptSha256s[index],
    auth_observation_sha256: digest(`${phase}:auth`),
    codex_jsonl_sha256: digest(`${phase}:jsonl`),
    gateway_binding_sha256: digest(`${phase}:gateway`),
    host_policy_sha256: digest(`${phase}:policy`),
    output_sha256: sha256(canonicalJson(execution.transcript.outputs[phase])),
    phase,
    process_receipt_sha256: sha256(
      canonicalJson(execution.process_receipts[index]),
    ),
    prompt_input_sha256: digest(`${phase}:prompt`),
    request_sha256: sha256(canonicalJson(requests[index])),
    terminal_status: "completed",
    thread_id: threadIds[index],
  }));
  const sessionChain = signer.close();
  const unsignedComposition = {
    atomic_receipt_sha256s: atomicReceiptSha256s,
    bob_host_binding_sha256: sha256(
      canonicalJson(execution.transcript.binding),
    ),
    composition_observation: "three-atomic-phase-records-bound",
    event_chain_sha256: execution.transcript.event_chain_sha256,
    qualification: "not-evidence",
    report_sha256: report.sha256,
    result: null,
    schema_version: 1,
    thread_ids: threadIds,
    transcript_sha256: sha256(canonicalJson(execution.transcript)),
    verification_status: "unverified",
  };
  const composition = {
    ...unsignedComposition,
    composition_sha256: sha256(canonicalJson(unsignedComposition)),
  };
  const unsignedRecord = {
    claims: {
      authenticated_client_login:
        "controller-bound-chatgpt-status-observation-only",
      controller_state_chain: "ed25519-key-continuity-verified",
      provider_authentication: "not-attested",
      report_semantics: "not-attested",
      sandbox_qualification: "not-attested",
    },
    composition,
    execution,
    phase_records: [],
    qualification: "not-evidence",
    report,
    result: null,
    schema_version: 1,
    session_chain: sessionChain,
    session_chain_sha256: codexSessionChainSha256(sessionChain),
    verification_status: "unverified",
  };
  const liveRecord = {
    ...unsignedRecord,
    live_record_sha256: sha256(canonicalJson(unsignedRecord)),
  };
  const liveSession = {
    composition,
    controller_state_directory: stateRoot,
    execution,
    live_record: liveRecord,
    live_record_path: join(stateRoot, "live-session.json"),
    qualification: "not-evidence",
    report,
    result: null,
    schema_version: 1,
    session_chain: sessionChain,
    session_chain_path: join(stateRoot, "session-chain.json"),
    verification_status: "unverified",
  };
  await mkdir(stateRoot, { mode: 0o700 });
  await Promise.all([
    writeFile(
      liveSession.live_record_path,
      canonicalJson(liveRecord),
      { mode: 0o600 },
    ),
    writeFile(
      liveSession.session_chain_path,
      canonicalJson(sessionChain),
      { mode: 0o600 },
    ),
  ]);
  await Promise.all([
    chmod(liveSession.live_record_path, 0o600),
    chmod(liveSession.session_chain_path, 0o600),
    chmod(stateRoot, 0o700),
  ]);
  return liveSession;
}

function smokeGate() {
  return {
    blocking_evidence: [],
    checklist: [{
      evidence: [],
      id: selectedCase.smoke_checks[0],
      state: "Pass",
    }],
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

async function makeInput(t, leakedValue = null) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "qa-suite-composer-")),
  );
  const snapshotRoot = join(root, "artifacts");
  await mkdir(join(snapshotRoot, "QA", "evidence"), { recursive: true });
  t.after(async () => {
    await chmod(snapshotRoot, 0o700).catch(() => {});
    await rm(root, { force: true, recursive: true });
  });
  const reportBytes = Buffer.from(
    `# Bob control report\n${leakedValue ?? "No findings."}\n`,
  );
  const evidenceBytes = Buffer.from("screenshot\n");
  const declarations = [
    [evidencePath, evidenceBytes],
    [reportPath, reportBytes],
  ].sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right))
  );
  for (const [path, bytes] of declarations) {
    const absolute = join(snapshotRoot, path);
    await writeFile(absolute, bytes, { mode: 0o400 });
    await chmod(absolute, 0o400);
  }
  const artifacts = declarations.map(([path, bytes]) => ({
    mode: "0400",
    path,
    sha256: sha256(bytes),
    size: bytes.length,
  }));
  const closure = {
    artifacts,
    artifact_snapshot_root: "artifacts",
    artifact_tree_sha256: sha256(canonicalJson(artifacts)),
    case_id: selectedCase.id,
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
    controller_commit: controllerCommit,
    lane: "bob-qa",
    node_version: process.version,
    qualification: "not-evidence",
    result: null,
    run_id: runId,
    schema_version: 1,
    subject_commit: subjectCommit,
    suite_id: suite.id,
    verification_status: "unverified",
    workspace_tree_sha256: digest("workspace"),
  };
  const closedPath = join(root, "closed.json");
  await writeFile(closedPath, canonicalJson(closure), { mode: 0o600 });
  await chmod(closedPath, 0o600);
  await chmod(snapshotRoot, 0o500);
  const transcript = await makeTranscript(sha256(reportBytes));
  const report = {
    bytes: reportBytes.length,
    path: reportPath,
    sha256: sha256(reportBytes),
  };
  return {
    closedRun: {
      artifact_snapshot_path: snapshotRoot,
      closed_path: closedPath,
      closure,
    },
    liveSession: await makeLiveSession(
      makeExecution(transcript),
      report,
      join(root, "controller-state"),
    ),
    oracleSet: oracles,
    smokeGate: smokeGate(),
    suite,
  };
}

test("composes only closed, smoke-gated, leak-free non-evidence", async (t) => {
  const input = await makeInput(t);
  const result = await composeClosedCodexBobEvaluation(input);

  assert.equal(result.qualification, "not-evidence");
  assert.equal(result.verification_status, "unverified");
  assert.equal(result.result, null);
  assert.equal(result.preview.preview_assertions, "met");
  assert.equal(
    result.claims.literal_confidential_value_scan,
    "closed-artifacts-and-retained-records-passed",
  );
  assert.equal(result.claims.provider_authentication, "not-attested");
  assert.equal(result.claims.report_semantic_parity, "not-attested");
  assert.equal(result.claims.sandbox_qualification, "not-attested");
  assert.equal(result.claims.smoke_gate_provenance, "not-attested");

  const missingGate = structuredClone(input);
  delete missingGate.smokeGate;
  await assert.rejects(
    composeClosedCodexBobEvaluation(missingGate),
    /caller-supplied smoke gate must be an object/u,
  );

  const substituted = await makeInput(t);
  await writeFile(
    substituted.closedRun.closed_path,
    canonicalJson({ substituted: true }),
  );
  await assert.rejects(
    composeClosedCodexBobEvaluation(substituted),
    /retained closed run does not match its authority/u,
  );

  const leaked = await makeInput(t, oracles[0].pair_id);
  await assert.rejects(
    composeClosedCodexBobEvaluation(leaked),
    /closed output contains a confidential controller value/u,
  );
});
