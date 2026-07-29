import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  composeCodexBobPhaseRecords,
} from "../scripts/evaluation/codex-bob-phase-composition.mjs";
import {
  adaptCodexBobPhaseTurn,
} from "../scripts/evaluation/codex-bob-phase-adapter.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";
import {
  requestsFromBobHostTranscript,
  validateBobHostPhaseRequest,
  validateBobHostTranscript,
} from "../scripts/evaluation/bob-host-protocol.mjs";

const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const DISPATCH_ID = "dispatch_0123456789abcdef0123456789abcdef";
const RUN_ID = "run_0123456789abcdef0123456789abcdef";
const REPORT_PATH =
  "QA/2026-07-28-0415-bob-qa-primary-surface.md";
const REPORT_MARKDOWN = "# Bob QA\n\nThe primary task completed.\n";
const REPORT_IDENTIFIERS = Object.freeze({
  core_flow_ids: ["flow_00112233445566778899aabbccddeeff_01"],
  surface_id: "surface_00112233445566778899aabbccddeeff",
});
const INVENTORY = Object.freeze({
  surfaces: [
    {
      control_ids: ["control_primary"],
      id: "surface_primary",
    },
  ],
});
const MODEL = Object.freeze({
  tasks: [
    {
      control_ids: ["control_primary"],
      id: "task_primary",
      parent_task_id: null,
      surface_id: "surface_primary",
    },
  ],
});
const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const THREAD_IDS = Object.freeze([
  "01900000-0000-7000-8000-000000000145",
  "01900000-0000-7000-8000-000000000146",
  "01900000-0000-7000-8000-000000000147",
]);
const COMPOSITION_FIELDS = Object.freeze([
  "atomic_receipt_sha256s",
  "bob_host_binding_sha256",
  "composition_observation",
  "composition_sha256",
  "event_chain_sha256",
  "qualification",
  "report_sha256",
  "result",
  "schema_version",
  "thread_ids",
  "transcript_sha256",
  "verification_status",
]);

function digest(value) {
  return sha256(value);
}

function expectedBobBinding() {
  return {
    case_id: CASE_ID,
    controller_commit: "a".repeat(40),
    dispatch_id: DISPATCH_ID,
    lane: "bob-qa",
    report_identifiers: structuredClone(REPORT_IDENTIFIERS),
    run_id: RUN_ID,
    schema_version: 1,
    subject_commit: "b".repeat(40),
    suite_id: "bob-evaluation-v1",
  };
}

function phaseRequest(phase, binding) {
  const taskPhase = phase === "task_execution";
  return validateBobHostPhaseRequest(
    {
      allowed_capabilities: taskPhase
        ? ["observe-interface", "perform-task-actions"]
        : ["observe-interface"],
      binding: {
        case_id: binding.case_id,
        dispatch_id: binding.dispatch_id,
        lane: binding.lane,
        run_id: binding.run_id,
        schema_version: binding.schema_version,
        subject_commit: binding.subject_commit,
      },
      phase,
      prior_outputs: {
        expected_use_model: taskPhase ? structuredClone(MODEL) : null,
        interface_inventory:
          phase === "interface_inventory"
            ? null
            : structuredClone(INVENTORY),
      },
      ...(taskPhase
        ? {
            report_identifiers: structuredClone(REPORT_IDENTIFIERS),
          }
        : {}),
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
    binding,
  );
}

function laneResult() {
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
            path: REPORT_PATH,
          },
        ],
        finding_ids: [],
        id: REPORT_IDENTIFIERS.core_flow_ids[0],
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
  };
}

function taskOutput() {
  const selectedLaneResult = laneResult();
  const evidenceSha256 = sha256(
    canonicalJson(selectedLaneResult.flows[0].evidence),
  );
  const reportSha256 = sha256(Buffer.from(REPORT_MARKDOWN, "utf8"));
  return {
    report_output: {
      lane_result: selectedLaneResult,
      report: {
        path: REPORT_PATH,
        sha256: reportSha256,
      },
    },
    results: [
      {
        control_ids: ["control_primary"],
        disposition: "exercised",
        evidence_sha256: evidenceSha256,
        flow_id: REPORT_IDENTIFIERS.core_flow_ids[0],
        task_id: "task_primary",
      },
    ],
  };
}

function taskWireOutput() {
  const output = taskOutput();
  return {
    lane_result: output.report_output.lane_result,
    report_markdown: REPORT_MARKDOWN,
    results: output.results.map((result) => ({
      control_ids: result.control_ids,
      disposition: result.disposition,
      flow_id: result.flow_id,
      task_id: result.task_id,
    })),
  };
}

function outputForPhase(phase) {
  if (phase === "interface_inventory") {
    return structuredClone(INVENTORY);
  }
  if (phase === "expected_use_model") {
    return structuredClone(MODEL);
  }
  return taskOutput();
}

function codexTurn(finalValue, threadId) {
  const events = [
    {
      thread_id: threadId,
      type: "thread.started",
    },
    {
      type: "turn.started",
    },
    {
      item: {
        id: "item_0",
        text: canonicalJson(finalValue),
        type: "agent_message",
      },
      type: "item.completed",
    },
    {
      type: "turn.completed",
      usage: {
        cache_write_input_tokens: 0,
        cached_input_tokens: 0,
        input_tokens: 1,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    },
  ];
  return `${events.map(JSON.stringify).join("\n")}\n`;
}

function gatewayBinding({
  codexSource,
  phase,
  request,
  threadId,
}) {
  const binding = {
    calls: [],
    codex_jsonl_sha256: sha256(Buffer.from(codexSource, "utf8")),
    gateway_closure_sha256: digest(`gateway closure ${phase}`),
    gateway_journal_last_sha256: digest(`gateway journal ${phase}`),
    gateway_policy_sha256: digest(`gateway policy ${phase}`),
    gateway_source_sha256: digest(`gateway source ${phase}`),
    gateway_tools_sha256: digest(`gateway tools ${phase}`),
    mcp_server: "browser_gateway",
    phase,
    request_sha256: sha256(canonicalJson(request)),
    thread_id: threadId,
  };
  return {
    binding,
    binding_sha256: sha256(canonicalJson(binding)),
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
}

function publicAtomicPhaseRecords(binding) {
  return PHASES.map((phase, index) => {
    const request = phaseRequest(phase, binding);
    const finalValue = phase === "task_execution"
      ? taskWireOutput()
      : outputForPhase(phase);
    const codexSource = codexTurn(finalValue, THREAD_IDS[index]);
    return adaptCodexBobPhaseTurn({
      codexSource,
      expectedBobBinding: binding,
      gatewayBinding: gatewayBinding({
        codexSource,
        phase,
        request,
        threadId: THREAD_IDS[index],
      }),
      reportPath: phase === "task_execution" ? REPORT_PATH : null,
      request,
    });
  });
}

function reportCandidateForPhase(phase) {
  if (phase !== "task_execution") {
    return null;
  }
  const bytes = Buffer.from(REPORT_MARKDOWN, "utf8");
  return {
    bytes,
    path: REPORT_PATH,
    sha256: sha256(bytes),
  };
}

function atomicPhaseRecord(phase, index, binding) {
  const output = outputForPhase(phase);
  const reportCandidate = reportCandidateForPhase(phase);
  const receiptBinding = {
    bob_host_binding_sha256: sha256(canonicalJson(binding)),
    codex_final_message_id: "item_0",
    codex_final_message_sequence: 3,
    codex_jsonl_sha256: digest(`Codex JSONL ${phase}`),
    gateway_binding_sha256: digest(`gateway binding ${phase}`),
    output_sha256: sha256(canonicalJson(output)),
    phase,
    report_sha256: reportCandidate?.sha256 ?? null,
    request_sha256: sha256(canonicalJson(phaseRequest(phase, binding))),
    thread_id: THREAD_IDS[index],
  };
  return {
    output,
    report_candidate: reportCandidate,
    receipt: {
      binding: receiptBinding,
      binding_sha256: sha256(canonicalJson(receiptBinding)),
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
  };
}

function phaseRecords(binding) {
  return PHASES.map((phase, index) =>
    atomicPhaseRecord(phase, index, binding)
  );
}

function validInput() {
  const binding = expectedBobBinding();
  return {
    expectedBobBinding: binding,
    phaseRecords: phaseRecords(binding),
  };
}

function rehashReceipt(record) {
  record.receipt.binding_sha256 = sha256(
    canonicalJson(record.receipt.binding),
  );
}

function compose(input = validInput()) {
  return composeCodexBobPhaseRecords(input);
}

test("composes three public atomic adapter outputs", () => {
  const binding = expectedBobBinding();
  const records = publicAtomicPhaseRecords(binding);
  const composed = compose({
    expectedBobBinding: binding,
    phaseRecords: records,
  });

  records.forEach((record, index) => {
    assert.equal(
      record.receipt.binding.bob_host_binding_sha256,
      sha256(canonicalJson(binding)),
    );
    assert.equal(
      record.receipt.binding.output_sha256,
      sha256(canonicalJson(record.output)),
    );
    assert.equal(
      record.receipt.binding.request_sha256,
      sha256(canonicalJson(phaseRequest(PHASES[index], binding))),
    );
    assert.equal(
      record.receipt.binding_sha256,
      sha256(canonicalJson(record.receipt.binding)),
    );
  });

  assert.equal(
    validateBobHostTranscript(composed.transcript),
    composed.transcript,
  );
  assert.deepEqual(composed.transcript.outputs, {
    expected_use_model: records[1].output,
    interface_inventory: records[0].output,
    task_execution: records[2].output,
  });
  assert.deepEqual(
    requestsFromBobHostTranscript(composed.transcript)
      .map((request) => sha256(canonicalJson(request))),
    records.map(({ receipt }) => receipt.binding.request_sha256),
  );
  assert.deepEqual(
    composed.composition.atomic_receipt_sha256s,
    records.map(({ receipt }) => sha256(canonicalJson(receipt))),
  );
  assert.deepEqual(
    composed.report_candidate,
    records[2].report_candidate,
  );
  assert.equal(
    composed.report_candidate.sha256,
    sha256(composed.report_candidate.bytes),
  );
});

test("composes exactly three atomic phase records into the Bob transcript", () => {
  const input = validInput();
  const composed = compose(input);

  assert.deepEqual(
    Object.keys(composed).sort(),
    ["composition", "report_candidate", "transcript"],
  );
  assert.deepEqual(
    Object.keys(composed.composition).sort(),
    [...COMPOSITION_FIELDS].sort(),
  );
  assert.equal(
    validateBobHostTranscript(composed.transcript),
    composed.transcript,
  );
  assert.deepEqual(composed.transcript.outputs, {
    expected_use_model: input.phaseRecords[1].output,
    interface_inventory: input.phaseRecords[0].output,
    task_execution: input.phaseRecords[2].output,
  });
  assert.deepEqual(
    composed.transcript.events.map(({ phase }) => phase),
    PHASES,
  );
  assert.deepEqual(
    composed.transcript.events.map(({ output_sha256: digestValue }) =>
      digestValue
    ),
    input.phaseRecords.map(
      ({ receipt }) => receipt.binding.output_sha256,
    ),
  );

  const requests = requestsFromBobHostTranscript(composed.transcript);
  assert.deepEqual(
    requests.map((request) => sha256(canonicalJson(request))),
    input.phaseRecords.map(
      ({ receipt }) => receipt.binding.request_sha256,
    ),
  );

  assert.ok(Buffer.isBuffer(composed.report_candidate.bytes));
  assert.deepEqual(
    composed.report_candidate,
    input.phaseRecords[2].report_candidate,
  );
  assert.deepEqual(composed.composition.atomic_receipt_sha256s, (
    input.phaseRecords.map(({ receipt }) =>
      sha256(canonicalJson(receipt))
    )
  ));
  assert.equal(
    composed.composition.bob_host_binding_sha256,
    sha256(canonicalJson(input.expectedBobBinding)),
  );
  assert.equal(
    composed.composition.composition_observation,
    "three-atomic-phase-records-bound",
  );
  assert.equal(
    composed.composition.event_chain_sha256,
    composed.transcript.event_chain_sha256,
  );
  assert.equal(
    composed.composition.report_sha256,
    composed.report_candidate.sha256,
  );
  assert.deepEqual(composed.composition.thread_ids, THREAD_IDS);
  assert.equal(
    composed.composition.transcript_sha256,
    sha256(canonicalJson(composed.transcript)),
  );
  assert.deepEqual(
    {
      qualification: composed.composition.qualification,
      result: composed.composition.result,
      schema_version: composed.composition.schema_version,
      verification_status: composed.composition.verification_status,
    },
    {
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
  );
  const {
    composition_sha256: compositionSha256,
    ...unsignedComposition
  } = composed.composition;
  assert.equal(
    compositionSha256,
    sha256(canonicalJson(unsignedComposition)),
  );
});

test("requires exactly one ordered record for each Bob phase", () => {
  const missing = validInput();
  missing.phaseRecords.pop();
  assert.throws(
    () => compose(missing),
    /phase|record|three|3/u,
  );

  const extra = validInput();
  extra.phaseRecords.push(extra.phaseRecords[0]);
  assert.throws(
    () => compose(extra),
    /phase|record|three|3/u,
  );

  const reordered = validInput();
  [
    reordered.phaseRecords[0],
    reordered.phaseRecords[1],
  ] = [
    reordered.phaseRecords[1],
    reordered.phaseRecords[0],
  ];
  assert.throws(
    () => compose(reordered),
    /order|phase|record/u,
  );

  const substitutedPhase = validInput();
  substitutedPhase.phaseRecords[0].receipt.binding.phase =
    "expected_use_model";
  rehashReceipt(substitutedPhase.phaseRecords[0]);
  assert.throws(
    () => compose(substitutedPhase),
    /order|phase|record/u,
  );
});

test("rejects cross-record authority substitution after local digest repair", () => {
  const bindingSubstitution = validInput();
  bindingSubstitution.expectedBobBinding.controller_commit =
    "c".repeat(40);
  bindingSubstitution.phaseRecords[0]
    .receipt.binding.bob_host_binding_sha256 = sha256(
      canonicalJson(bindingSubstitution.expectedBobBinding),
    );
  rehashReceipt(bindingSubstitution.phaseRecords[0]);
  assert.throws(
    () => compose(bindingSubstitution),
    /binding|receipt|authority/u,
  );

  const requestSubstitution = validInput();
  requestSubstitution.phaseRecords[1].receipt.binding.request_sha256 =
    digest("substituted request");
  rehashReceipt(requestSubstitution.phaseRecords[1]);
  assert.throws(
    () => compose(requestSubstitution),
    /request|dependency|receipt/u,
  );

  const outputSubstitution = validInput();
  outputSubstitution.phaseRecords[0].output.surfaces[0].id =
    "surface_substituted";
  outputSubstitution.phaseRecords[0].receipt.binding.output_sha256 = sha256(
    canonicalJson(outputSubstitution.phaseRecords[0].output),
  );
  rehashReceipt(outputSubstitution.phaseRecords[0]);
  assert.throws(
    () => compose(outputSubstitution),
    /inventory|model|output|request|surface|transcript/u,
  );

  const receiptSubstitution = validInput();
  receiptSubstitution.phaseRecords[1].receipt =
    receiptSubstitution.phaseRecords[0].receipt;
  assert.throws(
    () => compose(receiptSubstitution),
    /order|phase|receipt|request/u,
  );
});

test("requires one distinct recorded Codex thread per phase", () => {
  const input = validInput();
  input.phaseRecords[2].receipt.binding.thread_id =
    input.phaseRecords[0].receipt.binding.thread_id;
  rehashReceipt(input.phaseRecords[2]);

  assert.throws(
    () => compose(input),
    /distinct|thread/u,
  );
});

test("rejects report candidate byte, path, and digest substitution", () => {
  const byteSubstitution = validInput();
  const substitutedBytes = Buffer.from(
    "# Bob QA\n\nSubstituted report.\n",
    "utf8",
  );
  byteSubstitution.phaseRecords[2].report_candidate.bytes =
    substitutedBytes;
  byteSubstitution.phaseRecords[2].report_candidate.sha256 =
    sha256(substitutedBytes);
  assert.throws(
    () => compose(byteSubstitution),
    /byte|digest|report|sha256/u,
  );

  const pathSubstitution = validInput();
  pathSubstitution.phaseRecords[2].report_candidate.path =
    "QA/2026-07-28-0416-bob-qa-substituted-surface.md";
  assert.throws(
    () => compose(pathSubstitution),
    /path|report/u,
  );

  const digestSubstitution = validInput();
  const substitutedDigest = digest("substituted report digest");
  digestSubstitution.phaseRecords[2].report_candidate.sha256 =
    substitutedDigest;
  digestSubstitution.phaseRecords[2].receipt.binding.report_sha256 =
    substitutedDigest;
  rehashReceipt(digestSubstitution.phaseRecords[2]);
  assert.throws(
    () => compose(digestSubstitution),
    /byte|digest|output|report|sha256/u,
  );
});

test("snapshots accessor-backed phase output once before binding", () => {
  const input = validInput();
  const taskRecord = input.phaseRecords[2];
  const boundOutput = taskRecord.output;
  const substitutedOutput = structuredClone(boundOutput);
  substitutedOutput.report_output.lane_result.not_tested = [
    "accessor substitution",
  ];
  let reads = 0;
  Object.defineProperty(taskRecord, "output", {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? boundOutput : substitutedOutput;
    },
  });

  const composed = compose(input);

  assert.equal(reads, 1);
  assert.deepEqual(
    composed.transcript.outputs.task_execution,
    boundOutput,
  );
  assert.equal(
    sha256(canonicalJson(composed.transcript.outputs.task_execution)),
    taskRecord.receipt.binding.output_sha256,
  );
});

test("snapshots accessor-backed report bytes once before hashing", () => {
  const input = validInput();
  const reportCandidate = input.phaseRecords[2].report_candidate;
  const boundBytes = Buffer.from(reportCandidate.bytes);
  const substitutedBytes = Buffer.from(
    "# Bob QA\n\nAccessor-substituted report bytes.\n",
    "utf8",
  );
  let reads = 0;
  Object.defineProperty(reportCandidate, "bytes", {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? boundBytes : substitutedBytes;
    },
  });

  const composed = compose(input);

  assert.equal(reads, 1);
  assert.ok(Buffer.isBuffer(composed.report_candidate.bytes));
  assert.deepEqual(composed.report_candidate.bytes, boundBytes);
  assert.equal(
    sha256(composed.report_candidate.bytes),
    composed.report_candidate.sha256,
  );
});

test("clones output before later sibling getters can mutate it", () => {
  for (const siblingName of ["receipt", "report_candidate"]) {
    const input = validInput();
    const taskRecord = input.phaseRecords[2];
    const mutableOutput = taskRecord.output;
    const expectedOutput = structuredClone(mutableOutput);
    const siblingValue = taskRecord[siblingName];
    const expectedOutputSha256 =
      taskRecord.receipt.binding.output_sha256;
    let outputReads = 0;
    let siblingReads = 0;
    Object.defineProperty(taskRecord, "output", {
      configurable: true,
      enumerable: true,
      get() {
        outputReads += 1;
        return mutableOutput;
      },
    });
    Object.defineProperty(taskRecord, siblingName, {
      configurable: true,
      enumerable: true,
      get() {
        siblingReads += 1;
        mutableOutput.report_output.lane_result.not_tested = [
          `${siblingName} getter mutation`,
        ];
        return siblingValue;
      },
    });

    const composed = compose(input);

    assert.equal(outputReads, 1, siblingName);
    assert.equal(siblingReads, 1, siblingName);
    assert.deepEqual(
      composed.transcript.outputs.task_execution,
      expectedOutput,
      siblingName,
    );
    assert.equal(
      sha256(canonicalJson(composed.transcript.outputs.task_execution)),
      expectedOutputSha256,
      siblingName,
    );
  }
});

test("copies report bytes before later sibling getters can mutate them", () => {
  for (const siblingName of ["path", "sha256"]) {
    const input = validInput();
    const reportCandidate = input.phaseRecords[2].report_candidate;
    const mutableBytes = reportCandidate.bytes;
    const expectedBytes = Buffer.from(mutableBytes);
    const expectedPath = reportCandidate.path;
    const expectedSha256 = reportCandidate.sha256;
    const siblingValue = reportCandidate[siblingName];
    let byteReads = 0;
    let siblingReads = 0;
    Object.defineProperty(reportCandidate, "bytes", {
      configurable: true,
      enumerable: true,
      get() {
        byteReads += 1;
        return mutableBytes;
      },
    });
    Object.defineProperty(reportCandidate, siblingName, {
      configurable: true,
      enumerable: true,
      get() {
        siblingReads += 1;
        mutableBytes.fill(0x78);
        return siblingValue;
      },
    });

    const composed = compose(input);

    assert.equal(byteReads, 1, siblingName);
    assert.equal(siblingReads, 1, siblingName);
    assert.ok(Buffer.isBuffer(composed.report_candidate.bytes));
    assert.deepEqual(
      composed.report_candidate.bytes,
      expectedBytes,
      siblingName,
    );
    assert.equal(
      composed.report_candidate.path,
      expectedPath,
      siblingName,
    );
    assert.equal(
      composed.report_candidate.sha256,
      expectedSha256,
      siblingName,
    );
    assert.equal(
      sha256(composed.report_candidate.bytes),
      composed.report_candidate.sha256,
      siblingName,
    );
  }
});

test("rejects promoted atomic markers and emits fixed composition markers", () => {
  for (const [name, value] of [
    ["verification_status", "verified"],
    ["qualification", "evidence"],
    ["result", {}],
    ["schema_version", 2],
  ]) {
    const input = validInput();
    input.phaseRecords[1].receipt[name] = value;
    assert.throws(
      () => compose(input),
      /atomic|non-qualifying|not-evidence|receipt|unverified/u,
    );
  }

  const composition = compose().composition;
  assert.deepEqual(
    {
      qualification: composition.qualification,
      result: composition.result,
      schema_version: composition.schema_version,
      verification_status: composition.verification_status,
    },
    {
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
  );
});

test("composition module exposes one API and imports only its authorities", async () => {
  const module = await import(
    "../scripts/evaluation/codex-bob-phase-composition.mjs"
  );
  assert.deepEqual(
    Object.keys(module),
    ["composeCodexBobPhaseRecords"],
  );

  const source = await readFile(
    new URL(
      "../scripts/evaluation/codex-bob-phase-composition.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const directImports = [
    ...source.matchAll(
      /^import[\s\S]*?from\s+["']([^"']+)["'];$/gmu,
    ),
  ].map((match) => match[1]);
  const importStatements = [
    ...source.matchAll(/^[ \t]*import\b/gmu),
  ];
  assert.equal(importStatements.length, directImports.length);
  assert.deepEqual(
    directImports,
    [
      "./contracts.mjs",
      "./bob-host-protocol.mjs",
    ],
  );
  assert.doesNotMatch(source, /\bimport\s*\(/u);
});
