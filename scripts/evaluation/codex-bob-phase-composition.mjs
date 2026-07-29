import {
  canonicalJson,
  sha256,
} from "./contracts.mjs";
import {
  requestsFromBobHostTranscript,
  validateBobHostTranscript,
} from "./bob-host-protocol.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const ITEM_ID = /^item_(?:0|[1-9][0-9]*)$/u;
const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ZERO_DIGEST = "0".repeat(64);
const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const UNATTESTED_CLAIMS = Object.freeze({
  command_environment: "not-attested",
  command_network: "not-attested",
  context_isolation: "not-attested",
  execution_isolation: "not-attested",
  filesystem_isolation: "not-attested",
  method_order: "not-attested",
  state_authentication: "not-attested",
  tool_inventory: "not-attested",
});

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

function assertDenseArray(value, label, length) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} items`);
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

function snapshotReportCandidate(value, label) {
  if (value === null) {
    return null;
  }
  assertExactKeys(value, ["bytes", "path", "sha256"], label);
  const bytes = value.bytes;
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`${label}.bytes must be a Buffer`);
  }
  const copiedBytes = Buffer.from(bytes);
  const path = value.path;
  const candidateSha256 = value.sha256;
  return {
    bytes: copiedBytes,
    path,
    sha256: candidateSha256,
  };
}

function snapshotAtomicRecord(value, label) {
  assertExactKeys(
    value,
    ["output", "receipt", "report_candidate"],
    label,
  );
  const output = value.output;
  assertObject(output, `${label}.output`);
  const clonedOutput = structuredClone(output);
  const receipt = value.receipt;
  assertObject(receipt, `${label}.receipt`);
  const clonedReceipt = structuredClone(receipt);
  const reportCandidate = value.report_candidate;
  return {
    output: clonedOutput,
    receipt: clonedReceipt,
    reportCandidate: snapshotReportCandidate(
      reportCandidate,
      `${label}.report_candidate`,
    ),
  };
}

function validateAtomicReceipt(
  value,
  phase,
  output,
  reportCandidate,
  bobHostBindingSha256,
  label,
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
    `${label}.receipt`,
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error(`${label}.receipt must remain non-qualifying`);
  }
  assertExactKeys(
    value.binding,
    [
      "bob_host_binding_sha256",
      "codex_final_message_id",
      "codex_final_message_sequence",
      "codex_jsonl_sha256",
      "gateway_binding_sha256",
      "output_sha256",
      "phase",
      "report_sha256",
      "request_sha256",
      "thread_id",
    ],
    `${label}.receipt.binding`,
  );
  for (const name of [
    "bob_host_binding_sha256",
    "codex_jsonl_sha256",
    "gateway_binding_sha256",
    "output_sha256",
    "request_sha256",
  ]) {
    assertDigest(
      value.binding[name],
      `${label}.receipt.binding.${name}`,
    );
  }
  assertDigest(value.binding_sha256, `${label}.receipt.binding_sha256`);
  if (
    typeof value.binding.codex_final_message_id !== "string" ||
    !ITEM_ID.test(value.binding.codex_final_message_id)
  ) {
    throw new Error(
      `${label}.receipt.binding.codex_final_message_id is invalid`,
    );
  }
  assertPositiveInteger(
    value.binding.codex_final_message_sequence,
    `${label}.receipt.binding.codex_final_message_sequence`,
  );
  if (
    typeof value.binding.thread_id !== "string" ||
    !THREAD_ID.test(value.binding.thread_id)
  ) {
    throw new Error(`${label}.receipt.binding.thread_id is invalid`);
  }
  const expectedReportSha256 = reportCandidate?.sha256 ?? null;
  if (
    value.binding.bob_host_binding_sha256 !== bobHostBindingSha256 ||
    value.binding.output_sha256 !== sha256(canonicalJson(output)) ||
    value.binding.phase !== phase ||
    value.binding.report_sha256 !== expectedReportSha256
  ) {
    throw new Error(`${label}.receipt binding does not match its atomic record`);
  }
  if (value.binding.report_sha256 !== null) {
    assertDigest(
      value.binding.report_sha256,
      `${label}.receipt.binding.report_sha256`,
    );
  }
  if (value.binding_sha256 !== sha256(canonicalJson(value.binding))) {
    throw new Error(`${label}.receipt binding digest does not match`);
  }
  return {
    atomicReceiptSha256: sha256(canonicalJson(value)),
    requestSha256: value.binding.request_sha256,
    threadId: value.binding.thread_id,
  };
}

function validateReportCandidate(value, output, label) {
  if (value === null) {
    throw new Error(`${label} must be an object`);
  }
  assertDigest(value.sha256, `${label}.sha256`);
  if (
    value.sha256 !== sha256(value.bytes) ||
    value.path !== output?.report_output?.report?.path ||
    value.sha256 !== output?.report_output?.report?.sha256
  ) {
    throw new Error(`${label} does not match the task report output`);
  }
  return value;
}

function validateAtomicRecord(
  value,
  phase,
  index,
  bobHostBindingSha256,
) {
  const label = `phaseRecords[${index}]`;
  const record = snapshotAtomicRecord(value, label);
  let reportCandidate = null;
  if (phase === "task_execution") {
    reportCandidate = validateReportCandidate(
      record.reportCandidate,
      record.output,
      `${label}.report_candidate`,
    );
  } else if (record.reportCandidate !== null) {
    throw new Error(`${label}.report_candidate must be null before task execution`);
  }
  const receipt = validateAtomicReceipt(
    record.receipt,
    phase,
    record.output,
    reportCandidate,
    bobHostBindingSha256,
    label,
  );
  return {
    ...receipt,
    output: record.output,
    reportCandidate,
  };
}

function transcriptEvent(binding, phase, output, index, previousSha256) {
  const event = {
    binding_sha256: sha256(canonicalJson(binding)),
    dispatch_id: binding.dispatch_id,
    output_sha256: sha256(canonicalJson(output)),
    phase,
    previous_sha256: previousSha256,
    run_id: binding.run_id,
    schema_version: 1,
    sequence: index + 1,
  };
  return {
    ...event,
    sha256: sha256(canonicalJson(event)),
  };
}

function composeTranscript(binding, records) {
  const outputs = Object.fromEntries(
    PHASES.map((phase, index) => [phase, records[index].output]),
  );
  const events = [];
  let previousSha256 = ZERO_DIGEST;
  PHASES.forEach((phase, index) => {
    const event = transcriptEvent(
      binding,
      phase,
      outputs[phase],
      index,
      previousSha256,
    );
    events.push(event);
    previousSha256 = event.sha256;
  });
  return validateBobHostTranscript({
    binding,
    claims: { ...UNATTESTED_CLAIMS },
    event_chain_sha256: previousSha256,
    events,
    outputs,
    protocol_observation: "inventory-model-tasks-sequenced",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  });
}

function compositionWithDigest({
  atomicReceiptSha256s,
  bobHostBindingSha256,
  eventChainSha256,
  reportSha256,
  threadIds,
  transcriptSha256,
}) {
  const unsigned = {
    atomic_receipt_sha256s: atomicReceiptSha256s,
    bob_host_binding_sha256: bobHostBindingSha256,
    composition_observation: "three-atomic-phase-records-bound",
    event_chain_sha256: eventChainSha256,
    qualification: "not-evidence",
    report_sha256: reportSha256,
    result: null,
    schema_version: 1,
    thread_ids: threadIds,
    transcript_sha256: transcriptSha256,
    verification_status: "unverified",
  };
  return {
    atomic_receipt_sha256s: unsigned.atomic_receipt_sha256s,
    bob_host_binding_sha256: unsigned.bob_host_binding_sha256,
    composition_observation: unsigned.composition_observation,
    composition_sha256: sha256(canonicalJson(unsigned)),
    event_chain_sha256: unsigned.event_chain_sha256,
    qualification: unsigned.qualification,
    report_sha256: unsigned.report_sha256,
    result: unsigned.result,
    schema_version: unsigned.schema_version,
    thread_ids: unsigned.thread_ids,
    transcript_sha256: unsigned.transcript_sha256,
    verification_status: unsigned.verification_status,
  };
}

export function composeCodexBobPhaseRecords({
  expectedBobBinding,
  phaseRecords,
}) {
  assertDenseArray(phaseRecords, "phaseRecords", PHASES.length);
  const selectedBobBinding = structuredClone(expectedBobBinding);
  const bobHostBindingSha256 = sha256(canonicalJson(selectedBobBinding));
  const records = PHASES.map((phase, index) =>
    validateAtomicRecord(
      phaseRecords[index],
      phase,
      index,
      bobHostBindingSha256,
    )
  );
  const threadIds = records.map(({ threadId }) => threadId);
  if (new Set(threadIds).size !== PHASES.length) {
    throw new Error("atomic phase records must use three distinct thread IDs");
  }

  const transcript = composeTranscript(selectedBobBinding, records);
  const requests = requestsFromBobHostTranscript(transcript);
  requests.forEach((request, index) => {
    if (
      records[index].requestSha256 !== sha256(canonicalJson(request))
    ) {
      throw new Error(
        `phaseRecords[${index}] request digest does not match the transcript`,
      );
    }
  });
  const reportCandidate = records[2].reportCandidate;
  const transcriptSha256 = sha256(canonicalJson(transcript));
  const composition = compositionWithDigest({
    atomicReceiptSha256s: records.map(
      ({ atomicReceiptSha256 }) => atomicReceiptSha256,
    ),
    bobHostBindingSha256,
    eventChainSha256: transcript.event_chain_sha256,
    reportSha256: reportCandidate.sha256,
    threadIds,
    transcriptSha256,
  });
  return {
    composition,
    report_candidate: reportCandidate,
    transcript,
  };
}
