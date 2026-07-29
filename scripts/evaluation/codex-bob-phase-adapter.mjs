import {
  canonicalJson,
  isCanonicalBobReportPath,
  parseContractJson,
  sha256,
} from "./contracts.mjs";
import { parseCodex0145TurnJsonl } from "./codex-0145-events.mjs";
import {
  validateBobHostPhaseRequest,
  validateExpectedUseModel,
  validateInterfaceInventory,
  validateTaskExecution,
} from "./bob-host-protocol.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

function assertObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(observed) !== canonicalJson(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertDenseArray(value, label, maximum, minimum = 0) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${label} must contain ${minimum}-${maximum} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    throw new Error(`${label} must not contain named properties`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function gatewayResultSha256(call) {
  const text = call.result?.content?.[0];
  if (text?.type !== "text" || typeof text.text !== "string") {
    throw new Error(`gateway ${call.tool} first result must be text`);
  }
  const result = parseContractJson(
    text.text,
    `gateway ${call.tool} first result`,
  );
  if (text.text !== canonicalJson(result)) {
    throw new Error(`gateway ${call.tool} first result must use canonical JSON`);
  }
  return sha256(canonicalJson(result));
}

function validateGatewayCall(
  value,
  turnCall,
  mcpServer,
  previousJournalSequence,
) {
  assertExactKeys(
    value,
    [
      "codex_completed_sequence",
      "codex_item_id",
      "codex_started_sequence",
      "gateway_journal_sequence",
      "request_sha256",
      "result_sha256",
      "tool",
    ],
    "gateway binding call",
  );
  for (const [name, observed] of [
    ["codex_completed_sequence", value.codex_completed_sequence],
    ["codex_started_sequence", value.codex_started_sequence],
    ["gateway_journal_sequence", value.gateway_journal_sequence],
  ]) {
    assertPositiveInteger(observed, `gateway binding call.${name}`);
  }
  assertDigest(
    value.request_sha256,
    "gateway binding call.request_sha256",
  );
  assertDigest(
    value.result_sha256,
    "gateway binding call.result_sha256",
  );
  if (turnCall.server !== mcpServer) {
    throw new Error("Codex call used a different MCP server");
  }
  const expectedRequestSha256 = sha256(canonicalJson({
    arguments: turnCall.arguments,
    name: turnCall.tool,
  }));
  const expectedResultSha256 = gatewayResultSha256(turnCall);
  if (
    value.codex_completed_sequence !== turnCall.completed_sequence ||
    value.codex_item_id !== turnCall.id ||
    value.codex_started_sequence !== turnCall.started_sequence ||
    value.gateway_journal_sequence <= previousJournalSequence ||
    value.request_sha256 !== expectedRequestSha256 ||
    value.result_sha256 !== expectedResultSha256 ||
    value.tool !== turnCall.tool
  ) {
    throw new Error("gateway binding call does not match the Codex turn");
  }
  return value.gateway_journal_sequence;
}

function validateGatewayBindingEnvelope(
  value,
  turn,
  phase,
  requestSha256,
) {
  assertExactKeys(
    value,
    [
      "binding",
      "binding_sha256",
      "qualification",
      "result",
      "schema_version",
      "verification_status",
    ],
    "gateway binding envelope",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error("gateway binding envelope must remain non-qualifying");
  }
  assertDigest(value.binding_sha256, "gateway binding envelope.binding_sha256");
  assertExactKeys(
    value.binding,
    [
      "calls",
      "codex_jsonl_sha256",
      "gateway_closure_sha256",
      "gateway_journal_last_sha256",
      "gateway_policy_sha256",
      "gateway_source_sha256",
      "gateway_tools_sha256",
      "mcp_server",
      "phase",
      "request_sha256",
      "thread_id",
    ],
    "gateway binding",
  );
  for (const name of [
    "codex_jsonl_sha256",
    "gateway_closure_sha256",
    "gateway_journal_last_sha256",
    "gateway_policy_sha256",
    "gateway_source_sha256",
    "gateway_tools_sha256",
    "request_sha256",
  ]) {
    assertDigest(value.binding[name], `gateway binding.${name}`);
  }
  if (
    typeof value.binding.mcp_server !== "string" ||
    value.binding.mcp_server.length === 0 ||
    value.binding.mcp_server.length > 256 ||
    value.binding.mcp_server.trim() !== value.binding.mcp_server ||
    value.binding.mcp_server.includes("\0")
  ) {
    throw new Error("gateway binding.mcp_server is invalid");
  }
  if (
    value.binding.codex_jsonl_sha256 !== turn.source_sha256 ||
    value.binding.phase !== phase ||
    value.binding.request_sha256 !== requestSha256 ||
    value.binding.thread_id !== turn.thread_id
  ) {
    throw new Error(
      "gateway binding does not match the phase request and turn; Codex binding mismatch",
    );
  }
  assertDenseArray(
    value.binding.calls,
    "gateway binding.calls",
    turn.mcp_calls.length,
  );
  if (value.binding.calls.length !== turn.mcp_calls.length) {
    throw new Error("gateway binding calls do not exhaust the Codex turn");
  }
  let journalSequence = 0;
  value.binding.calls.forEach((call, index) => {
    journalSequence = validateGatewayCall(
      call,
      turn.mcp_calls[index],
      value.binding.mcp_server,
      journalSequence,
    );
  });
  if (value.binding_sha256 !== sha256(canonicalJson(value.binding))) {
    throw new Error("gateway binding envelope digest does not match");
  }
  return value;
}

function parseCanonicalFinalMessage(turn) {
  let output;
  try {
    output = parseContractJson(
      turn.final_message.text,
      "Codex final Bob phase message",
    );
  } catch (error) {
    throw new Error(
      `Codex final Bob phase message JSON is invalid: ${error.message}`,
    );
  }
  assertObject(output, "Codex final Bob phase message");
  const canonicalSource = canonicalJson(output);
  const sourceWithoutTerminalLf = canonicalSource.slice(0, -1);
  if (
    turn.final_message.text !== canonicalSource &&
    turn.final_message.text !== sourceWithoutTerminalLf
  ) {
    throw new Error("Codex final Bob phase message must use canonical JSON");
  }
  return structuredClone(output);
}

function taskOutput(draft, request, reportPath) {
  if (!isCanonicalBobReportPath(reportPath)) {
    throw new Error("task execution requires a canonical Bob report path");
  }
  assertExactKeys(
    draft,
    ["lane_result", "report_markdown", "results"],
    "Codex task-execution draft",
  );
  assertObject(draft.lane_result, "Codex task-execution draft.lane_result");
  assertDenseArray(
    draft.lane_result.flows,
    "Codex task-execution draft.lane_result.flows",
    64,
    1,
  );
  if (
    typeof draft.report_markdown !== "string" ||
    Buffer.from(draft.report_markdown, "utf8").toString("utf8") !==
      draft.report_markdown
  ) {
    throw new Error("Codex task-execution report_markdown must be UTF-8 text");
  }
  assertDenseArray(
    draft.results,
    "Codex task-execution draft.results",
    256,
    1,
  );
  const flowById = new Map(
    draft.lane_result.flows.map((flow) => [flow.id, flow]),
  );
  const results = draft.results.map((result, index) => {
    assertExactKeys(
      result,
      ["control_ids", "disposition", "flow_id", "task_id"],
      `Codex task-execution draft.results[${index}]`,
    );
    const flow = flowById.get(result.flow_id);
    if (flow === undefined) {
      throw new Error(
        "Codex task-execution draft references an unknown flow outside the selected core flows",
      );
    }
    return {
      ...structuredClone(result),
      evidence_sha256: sha256(canonicalJson(flow.evidence)),
    };
  });
  const reportBytes = Buffer.from(draft.report_markdown, "utf8");
  const reportSha256 = sha256(reportBytes);
  const output = {
    report_output: {
      lane_result: structuredClone(draft.lane_result),
      report: {
        path: reportPath,
        sha256: reportSha256,
      },
    },
    results,
  };
  validateTaskExecution(
    output,
    request.prior_outputs.expected_use_model,
    request.report_identifiers,
    request.binding.case_id,
  );
  return {
    output,
    reportCandidate: {
      bytes: reportBytes,
      path: reportPath,
      sha256: reportSha256,
    },
  };
}

function phaseOutput(finalMessage, request, reportPath) {
  if (request.phase === "interface_inventory") {
    if (reportPath !== null) {
      throw new Error("report path appeared before task execution");
    }
    return {
      output: validateInterfaceInventory(finalMessage),
      reportCandidate: null,
    };
  }
  if (request.phase === "expected_use_model") {
    if (reportPath !== null) {
      throw new Error("report path appeared before task execution");
    }
    return {
      output: validateExpectedUseModel(
        finalMessage,
        request.prior_outputs.interface_inventory,
      ),
      reportCandidate: null,
    };
  }
  return taskOutput(finalMessage, request, reportPath);
}

export function adaptCodexBobPhaseTurn({
  codexSource,
  expectedBobBinding,
  gatewayBinding,
  reportPath = null,
  request,
}) {
  const turn = parseCodex0145TurnJsonl(codexSource);
  const selectedBobBinding = structuredClone(expectedBobBinding);
  const selectedRequest = validateBobHostPhaseRequest(
    structuredClone(request),
    selectedBobBinding,
  );
  const requestSha256 = sha256(canonicalJson(selectedRequest));
  const selectedGatewayBinding = validateGatewayBindingEnvelope(
    structuredClone(gatewayBinding),
    turn,
    selectedRequest.phase,
    requestSha256,
  );
  const finalMessage = parseCanonicalFinalMessage(turn);
  const { output, reportCandidate } = phaseOutput(
    finalMessage,
    selectedRequest,
    reportPath,
  );
  const binding = {
    bob_host_binding_sha256: sha256(canonicalJson(selectedBobBinding)),
    codex_final_message_id: turn.final_message.id,
    codex_final_message_sequence: turn.final_message.completed_sequence,
    codex_jsonl_sha256: turn.source_sha256,
    gateway_binding_sha256: selectedGatewayBinding.binding_sha256,
    output_sha256: sha256(canonicalJson(output)),
    phase: selectedRequest.phase,
    report_sha256: reportCandidate?.sha256 ?? null,
    request_sha256: requestSha256,
    thread_id: turn.thread_id,
  };
  return {
    output,
    report_candidate: reportCandidate,
    receipt: {
      binding,
      binding_sha256: sha256(canonicalJson(binding)),
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
  };
}
