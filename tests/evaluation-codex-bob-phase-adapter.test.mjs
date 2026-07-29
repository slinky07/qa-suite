import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  adaptCodexBobPhaseTurn,
} from "../scripts/evaluation/codex-bob-phase-adapter.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const THREAD_ID = "01900000-0000-7000-8000-000000000145";
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

function digest(character) {
  return character.repeat(64);
}

function expectedBobBinding() {
  return {
    case_id: CASE_ID,
    controller_commit: "a".repeat(40),
    dispatch_id: "dispatch_0123456789abcdef0123456789abcdef",
    lane: "bob-qa",
    report_identifiers: structuredClone(REPORT_IDENTIFIERS),
    run_id: "run_0123456789abcdef0123456789abcdef",
    schema_version: 1,
    subject_commit: "b".repeat(40),
    suite_id: "bob-evaluation-v1",
  };
}

function phaseRequest(phase) {
  const taskPhase = phase === "task_execution";
  return {
    allowed_capabilities: taskPhase
      ? ["observe-interface", "perform-task-actions"]
      : ["observe-interface"],
    binding: {
      case_id: CASE_ID,
      dispatch_id: "dispatch_0123456789abcdef0123456789abcdef",
      lane: "bob-qa",
      run_id: "run_0123456789abcdef0123456789abcdef",
      schema_version: 1,
      subject_commit: "b".repeat(40),
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
  };
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

function taskWireOutput(overrides = {}) {
  return {
    lane_result: laneResult(),
    report_markdown: REPORT_MARKDOWN,
    results: [
      {
        control_ids: ["control_primary"],
        disposition: "exercised",
        flow_id: REPORT_IDENTIFIERS.core_flow_ids[0],
        task_id: "task_primary",
      },
    ],
    ...overrides,
  };
}

function mcpResult(value) {
  return {
    content: [
      {
        text: canonicalJson(value),
        type: "text",
      },
    ],
    structured_content: null,
  };
}

function codexTurn(finalValue, calls = [], threadId = THREAD_ID) {
  const events = [
    {
      thread_id: threadId,
      type: "thread.started",
    },
    {
      type: "turn.started",
    },
  ];
  calls.forEach((call, index) => {
    const item = {
      arguments: structuredClone(call.arguments),
      error: null,
      id: `item_${index}`,
      result: null,
      server: "browser_gateway",
      status: "in_progress",
      tool: call.tool,
      type: "mcp_tool_call",
    };
    events.push({
      item: structuredClone(item),
      type: "item.started",
    });
    events.push({
      item: {
        ...structuredClone(item),
        result: mcpResult(call.result),
        status: "completed",
      },
      type: "item.completed",
    });
  });
  events.push({
    item: {
      id: `item_${calls.length}`,
      text:
        typeof finalValue === "string"
          ? finalValue
          : canonicalJson(finalValue),
      type: "agent_message",
    },
    type: "item.completed",
  });
  events.push({
    type: "turn.completed",
    usage: {
      cache_write_input_tokens: 0,
      cached_input_tokens: 0,
      input_tokens: 1,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  });
  return `${events.map(JSON.stringify).join("\n")}\n`;
}

function gatewayEnvelope({
  calls = [],
  codexSource,
  phase,
  request,
  threadId = THREAD_ID,
}) {
  const binding = {
    calls: calls.map((call, index) => ({
      codex_completed_sequence: 4 + (index * 2),
      codex_item_id: `item_${index}`,
      codex_started_sequence: 3 + (index * 2),
      gateway_journal_sequence: 4 + index,
      request_sha256: sha256(canonicalJson({
        arguments: call.arguments,
        name: call.tool,
      })),
      result_sha256: sha256(canonicalJson(call.result)),
      tool: call.tool,
    })),
    codex_jsonl_sha256: sha256(Buffer.from(codexSource, "utf8")),
    gateway_closure_sha256: digest("c"),
    gateway_journal_last_sha256: digest("d"),
    gateway_policy_sha256: digest("e"),
    gateway_source_sha256: digest("f"),
    gateway_tools_sha256: digest("1"),
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

function fixture(phase, finalValue, calls = []) {
  const request = phaseRequest(phase);
  const codexSource = codexTurn(finalValue, calls);
  return {
    codexSource,
    expectedBobBinding: expectedBobBinding(),
    gatewayBinding: gatewayEnvelope({
      calls,
      codexSource,
      phase,
      request,
    }),
    reportPath: phase === "task_execution" ? REPORT_PATH : null,
    request,
  };
}

function adapt(input) {
  return adaptCodexBobPhaseTurn(input);
}

function rehashGateway(gatewayBinding) {
  gatewayBinding.binding_sha256 = sha256(
    canonicalJson(gatewayBinding.binding),
  );
  return gatewayBinding;
}

test("adapts zero-call inventory and modeling turns directly", () => {
  for (const [phase, finalValue] of [
    ["interface_inventory", INVENTORY],
    ["expected_use_model", MODEL],
  ]) {
    const input = fixture(phase, finalValue);
    const adapted = adapt(input);

    assert.equal(
      canonicalJson(adapted.output),
      canonicalJson(finalValue),
    );
    assert.equal(adapted.report_candidate, null);
    assert.deepEqual(Object.keys(adapted), [
      "output",
      "report_candidate",
      "receipt",
    ]);
    assert.equal(adapted.receipt.schema_version, 1);
    assert.equal(adapted.receipt.verification_status, "unverified");
    assert.equal(adapted.receipt.qualification, "not-evidence");
    assert.equal(adapted.receipt.result, null);
    assert.deepEqual(adapted.receipt.binding, {
      bob_host_binding_sha256: sha256(
        canonicalJson(input.expectedBobBinding),
      ),
      codex_final_message_id: "item_0",
      codex_final_message_sequence: 3,
      codex_jsonl_sha256: sha256(
        Buffer.from(input.codexSource, "utf8"),
      ),
      gateway_binding_sha256: input.gatewayBinding.binding_sha256,
      output_sha256: sha256(canonicalJson(finalValue)),
      phase,
      report_sha256: null,
      request_sha256: sha256(canonicalJson(input.request)),
      thread_id: THREAD_ID,
    });
    assert.equal(
      adapted.receipt.binding_sha256,
      sha256(canonicalJson(adapted.receipt.binding)),
    );
  }
});

test("adapts one-call task output and derives report and evidence digests", () => {
  const calls = [
    {
      arguments: {
        control_id: "control_primary",
      },
      result: {
        control_id: "control_primary",
        schema_version: 1,
        status: "completed",
      },
      tool: "activate_control",
    },
  ];
  const wireOutput = taskWireOutput();
  const input = fixture("task_execution", wireOutput, calls);

  const adapted = adapt(input);

  const reportBytes = Buffer.from(REPORT_MARKDOWN, "utf8");
  const reportSha256 = sha256(reportBytes);
  const evidenceSha256 = sha256(
    canonicalJson(wireOutput.lane_result.flows[0].evidence),
  );
  assert.deepEqual(adapted.report_candidate, {
    bytes: reportBytes,
    path: REPORT_PATH,
    sha256: reportSha256,
  });
  assert.deepEqual(adapted.output, {
    report_output: {
      lane_result: wireOutput.lane_result,
      report: {
        path: REPORT_PATH,
        sha256: reportSha256,
      },
    },
    results: [
      {
        ...wireOutput.results[0],
        evidence_sha256: evidenceSha256,
      },
    ],
  });
  assert.equal(
    adapted.receipt.binding.output_sha256,
    sha256(canonicalJson(adapted.output)),
  );
  assert.equal(adapted.receipt.binding.report_sha256, reportSha256);
  assert.equal(adapted.receipt.binding.codex_final_message_id, "item_1");
  assert.equal(adapted.receipt.binding.codex_final_message_sequence, 5);
});

test("accepts canonical final JSON with only its terminal LF omitted", () => {
  const canonicalSource = canonicalJson(INVENTORY);
  const input = fixture(
    "interface_inventory",
    canonicalSource.slice(0, -1),
  );

  assert.deepEqual(adapt(input).output, INVENTORY);
});

test("requires canonical final JSON and exact authoritative wire fields", () => {
  const noncanonical = fixture(
    "interface_inventory",
    JSON.stringify(INVENTORY),
  );
  assert.throws(
    () => adapt(noncanonical),
    /canonical JSON/u,
  );

  const malformedJson = fixture(
    "interface_inventory",
    "{\"surfaces\":",
  );
  assert.throws(
    () => adapt(malformedJson),
    /invalid value/u,
  );

  const malformedTask = taskWireOutput({
    report_sha256: digest("a"),
  });
  assert.throws(
    () => adapt(fixture("task_execution", malformedTask)),
    /fields/u,
  );
});

test("delegates inventory and modeling semantics to Bob authorities", () => {
  const duplicateInventory = {
    surfaces: [
      {
        control_ids: ["control_primary", "control_primary"],
        id: "surface_primary",
      },
    ],
  };
  assert.throws(
    () =>
      adapt(fixture("interface_inventory", duplicateInventory)),
    /control_ids must be unique/u,
  );

  const incompleteModel = {
    tasks: [
      {
        control_ids: ["control_other"],
        id: "task_primary",
        parent_task_id: null,
        surface_id: "surface_primary",
      },
    ],
  };
  assert.throws(
    () => adapt(fixture("expected_use_model", incompleteModel)),
    /non-inventoried control/u,
  );
});

test("rejects request, turn, and gateway substitution", () => {
  const requestSubstitution = fixture(
    "interface_inventory",
    INVENTORY,
  );
  requestSubstitution.request.binding.run_id =
    "run_fedcba9876543210fedcba9876543210";
  assert.throws(
    () => adapt(requestSubstitution),
    /selected controller binding|request_sha256/u,
  );

  const turnSubstitution = fixture("interface_inventory", INVENTORY);
  turnSubstitution.codexSource = codexTurn(
    INVENTORY,
    [],
    "01900000-0000-7000-8000-000000000146",
  );
  assert.throws(
    () => adapt(turnSubstitution),
    /gateway binding does not match the phase request and turn/u,
  );

  const gatewaySubstitution = fixture(
    "interface_inventory",
    INVENTORY,
  );
  gatewaySubstitution.gatewayBinding.binding.phase =
    "expected_use_model";
  rehashGateway(gatewaySubstitution.gatewayBinding);
  assert.throws(
    () => adapt(gatewaySubstitution),
    /phase/u,
  );
});

test("rejects missing, extra, and reordered gateway call receipts", () => {
  const calls = [
    {
      arguments: {},
      result: {
        schema_version: 1,
        url: "http://127.0.0.1:4173/",
      },
      tool: "observe_page",
    },
    {
      arguments: {},
      result: {
        height: 900,
        schema_version: 1,
        width: 1280,
      },
      tool: "capture_screenshot",
    },
  ];
  const base = fixture("interface_inventory", INVENTORY, calls);

  const missing = structuredClone(base);
  missing.gatewayBinding.binding.calls.pop();
  rehashGateway(missing.gatewayBinding);
  assert.throws(
    () => adapt(missing),
    /call|exhaust|occurrence/u,
  );

  const extra = structuredClone(base);
  extra.gatewayBinding.binding.calls.push(
    structuredClone(extra.gatewayBinding.binding.calls[0]),
  );
  rehashGateway(extra.gatewayBinding);
  assert.throws(
    () => adapt(extra),
    /call|exhaust|occurrence/u,
  );

  const reordered = structuredClone(base);
  reordered.gatewayBinding.binding.calls.reverse();
  rehashGateway(reordered.gatewayBinding);
  assert.throws(
    () => adapt(reordered),
    /call|order|sequence/u,
  );
});

test("rejects coherently rehashed MCP request and result substitution", () => {
  const call = {
    arguments: {
      control_id: "control_primary",
    },
    result: {
      control_id: "control_primary",
      schema_version: 1,
      status: "completed",
    },
    tool: "activate_control",
  };
  const base = fixture("task_execution", taskWireOutput(), [call]);

  const requestSubstitution = structuredClone(base);
  const substitutedRequestCall = {
    ...call,
    arguments: {
      control_id: "control_other",
    },
  };
  requestSubstitution.codexSource = codexTurn(
    taskWireOutput(),
    [substitutedRequestCall],
  );
  requestSubstitution.gatewayBinding.binding.codex_jsonl_sha256 = sha256(
    Buffer.from(requestSubstitution.codexSource, "utf8"),
  );
  rehashGateway(requestSubstitution.gatewayBinding);
  assert.throws(
    () => adapt(requestSubstitution),
    /call|request/u,
  );

  const resultSubstitution = structuredClone(base);
  const substitutedResultCall = {
    ...call,
    result: {
      control_id: "control_primary",
      schema_version: 1,
      status: "substituted",
    },
  };
  resultSubstitution.codexSource = codexTurn(
    taskWireOutput(),
    [substitutedResultCall],
  );
  resultSubstitution.gatewayBinding.binding.codex_jsonl_sha256 = sha256(
    Buffer.from(resultSubstitution.codexSource, "utf8"),
  );
  rehashGateway(resultSubstitution.gatewayBinding);
  assert.throws(
    () => adapt(resultSubstitution),
    /call|result/u,
  );
});

test("derives task digests before authoritative validation", () => {
  const suppliedEvidenceDigest = taskWireOutput();
  suppliedEvidenceDigest.results[0].evidence_sha256 = digest("a");
  assert.throws(
    () =>
      adapt(fixture("task_execution", suppliedEvidenceDigest)),
    /Codex task-execution draft\.results\[0\] fields/u,
  );

  const wrongFlow = taskWireOutput();
  wrongFlow.results[0].flow_id =
    "flow_ffeeddccbbaa99887766554433221100_01";
  assert.throws(
    () => adapt(fixture("task_execution", wrongFlow)),
    /unknown flow/u,
  );

  const input = fixture("task_execution", taskWireOutput());
  input.reportPath = null;
  assert.throws(
    () => adapt(input),
    /reportPath|report path/u,
  );
});

test("rejects promoted gateway markers and emits fixed receipt markers", () => {
  for (const [name, value] of [
    ["verification_status", "verified"],
    ["qualification", "evidence"],
    ["result", {}],
    ["schema_version", 2],
  ]) {
    const input = fixture("interface_inventory", INVENTORY);
    input.gatewayBinding[name] = value;
    assert.throws(
      () => adapt(input),
      /gateway|non-qualifying|unverified|not-evidence/u,
    );
  }

  const receipt = adapt(
    fixture("interface_inventory", INVENTORY),
  ).receipt;
  assert.deepEqual(
    {
      qualification: receipt.qualification,
      result: receipt.result,
      schema_version: receipt.schema_version,
      verification_status: receipt.verification_status,
    },
    {
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
  );
});

test("exports only the adapter and directly imports or calls no ambient I/O API", async () => {
  const module = await import(
    "../scripts/evaluation/codex-bob-phase-adapter.mjs"
  );
  assert.deepEqual(Object.keys(module), ["adaptCodexBobPhaseTurn"]);

  const source = await readFile(
    new URL(
      "../scripts/evaluation/codex-bob-phase-adapter.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\bfrom\s+["']node:(?:child_process|cluster|dgram|dns|fs|http|https|net|tls|worker_threads)["']/u,
  );
  assert.doesNotMatch(source, /\bprocess\s*\./u);
  assert.doesNotMatch(
    source,
    /\b(?:exec|execFile|fetch|fork|open|readFile|spawn|writeFile)\s*\(/u,
  );
});
