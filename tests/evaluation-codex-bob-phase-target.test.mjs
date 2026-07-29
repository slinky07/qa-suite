import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  codexBobPhaseEvidencePath,
  parseCodexBobPhaseTargetConfig,
  validateCodexBobPhaseRecord,
} from "../scripts/evaluation/codex-bob-phase-target.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const RUN_ID = "run_0123456789abcdef0123456789abcdef";
const DISPATCH_ID = "dispatch_0123456789abcdef0123456789abcdef";
const REPORT_IDENTIFIERS = Object.freeze({
  core_flow_ids: ["flow_00112233445566778899aabbccddeeff_01"],
  surface_id: "surface_00112233445566778899aabbccddeeff",
});

function digest(character) {
  return character.repeat(64);
}

function expectedBinding() {
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

function inventoryRequest() {
  return {
    allowed_capabilities: ["observe-interface"],
    binding: {
      case_id: CASE_ID,
      dispatch_id: DISPATCH_ID,
      lane: "bob-qa",
      run_id: RUN_ID,
      schema_version: 1,
      subject_commit: "b".repeat(40),
    },
    phase: "interface_inventory",
    prior_outputs: {
      expected_use_model: null,
      interface_inventory: null,
    },
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
}

function identity(path, character, version) {
  return {
    path,
    sha256: digest(character),
    ...(version ? { version } : {}),
  };
}

function config() {
  const root = "/private/tmp/qa-suite-lane";
  return {
    allowed_paths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    expected_bob_binding: expectedBinding(),
    fixture_assets: [
      identity(`${root}/fixture/public/app.mjs`, "a"),
      identity(`${root}/fixture/public/index.html`, "b"),
    ],
    identities: {
      chrome: identity("/Applications/Chrome", "1"),
      codex: identity(
        "/opt/tools/codex",
        "2",
        "codex-cli 0.145.0",
      ),
      fixture_server: identity(`${root}/fixture/public/server.mjs`, "3"),
      gateway: identity(`${root}/controller/browser-gateway.mjs`, "4"),
      node: identity("/opt/tools/node", "5"),
    },
    lane_root: root,
    model: "gpt-5.4",
    output_schemas: {
      expected_use_model: identity(
        `${root}/controller/expected-use.schema.json`,
        "6",
      ),
      interface_inventory: identity(
        `${root}/controller/inventory.schema.json`,
        "7",
      ),
      task_execution: identity(
        `${root}/controller/task.schema.json`,
        "8",
      ),
    },
    prompt_inputs: [
      identity(`${root}/qa-suite/references/agents/bob-qa.md`, "9"),
    ],
    reasoning_effort: "xhigh",
    report_path: "QA/2026-07-28-2300-bob-qa-primary.md",
    target_path: "/",
  };
}

function stream(bytes, character) {
  return {
    bytes,
    sha256: bytes === 0 ? sha256(Buffer.alloc(0)) : digest(character),
  };
}

function authObservation() {
  const status = Buffer.from("Logged in using ChatGPT\n", "utf8");
  const warning = Buffer.from(
    "WARNING: proceeding, even though we could not create PATH aliases: " +
      "Operation not permitted (os error 1)\n",
    "utf8",
  );
  const stderr = Buffer.concat([warning, status]);
  return {
    arguments_sha256: digest("1"),
    exit_code: 0,
    login_method: "chatgpt",
    observation: "controller-observed-client-login-status",
    provider_attestation: "not-attested",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    stderr: {
      bytes: stderr.length,
      sha256: sha256(stderr),
    },
    stdout: stream(0, "2"),
    verification_status: "unverified",
  };
}

function promptInputObservation() {
  return {
    arguments_sha256: digest("3"),
    exit_code: 0,
    message_count: 2,
    observation: "digest-only-diagnostic-not-context-isolation-attestation",
    qualification: "not-evidence",
    result: null,
    roles: ["developer", "user"],
    schema_version: 1,
    stderr: stream(0, "4"),
    stdout: stream(128, "5"),
    verification_status: "unverified",
  };
}

function inventoryRecord(request) {
  const output = {
    surfaces: [
      {
        control_ids: ["control_primary"],
        id: "surface_primary",
      },
    ],
  };
  const codexSha256 = digest("d");
  const threadId = "01234567-89ab-cdef-0123-456789abcdef";
  const gatewayBinding = {
    binding: {
      calls: [
        {
          codex_completed_sequence: 3,
          codex_item_id: "item_1",
          codex_started_sequence: 2,
          gateway_journal_sequence: 1,
          request_sha256: digest("a"),
          result_sha256: digest("b"),
          tool: "observe_page",
        },
        {
          codex_completed_sequence: 6,
          codex_item_id: "item_2",
          codex_started_sequence: 5,
          gateway_journal_sequence: 2,
          request_sha256: digest("c"),
          result_sha256: digest("f"),
          tool: "capture_screenshot",
        },
      ],
      codex_jsonl_sha256: codexSha256,
      gateway_closure_sha256: digest("1"),
      gateway_journal_last_sha256: digest("2"),
      gateway_policy_sha256: digest("3"),
      gateway_source_sha256: digest("4"),
      gateway_tools_sha256: digest("5"),
      mcp_server: "bob_browser",
      phase: request.phase,
      request_sha256: sha256(canonicalJson(request)),
      thread_id: threadId,
    },
    binding_sha256: "",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
  gatewayBinding.binding_sha256 = sha256(
    canonicalJson(gatewayBinding.binding),
  );
  const atomicBinding = {
    bob_host_binding_sha256: sha256(canonicalJson(expectedBinding())),
    codex_final_message_id: "item_3",
    codex_final_message_sequence: 8,
    codex_jsonl_sha256: codexSha256,
    gateway_binding_sha256: gatewayBinding.binding_sha256,
    output_sha256: sha256(canonicalJson(output)),
    phase: request.phase,
    report_sha256: null,
    request_sha256: sha256(canonicalJson(request)),
    thread_id: threadId,
  };
  const atomicReceipt = {
    binding: atomicBinding,
    binding_sha256: sha256(canonicalJson(atomicBinding)),
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
  const record = {
    atomic_receipt: {
      ...structuredClone(atomicReceipt),
    },
    auth_observation: authObservation(),
    codex_jsonl: {
      bytes: 128,
      path:
        `QA/evidence/${RUN_ID}/${DISPATCH_ID}/` +
        "interface_inventory/codex-turn.jsonl",
      sha256: codexSha256,
    },
    gateway_binding: gatewayBinding,
    host_policy_sha256: digest("e"),
    output,
    prompt_input_observation: promptInputObservation(),
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
  return {
    authorities: {
      atomicRecord: {
        output: structuredClone(output),
        receipt: structuredClone(atomicReceipt),
        report_candidate: null,
      },
      gatewayBinding: structuredClone(gatewayBinding),
    },
    record,
  };
}

test("derives one deterministic dispatch-scoped evidence root", () => {
  assert.deepEqual(
    codexBobPhaseEvidencePath(
      "/private/tmp/qa-suite-lane",
      inventoryRequest(),
    ),
    {
      absolute_path:
        `/private/tmp/qa-suite-lane/QA/evidence/${RUN_ID}/` +
        `${DISPATCH_ID}/interface_inventory`,
      relative_path:
        `QA/evidence/${RUN_ID}/${DISPATCH_ID}/interface_inventory`,
    },
  );
});

test("accepts only canonical, closed target configuration", () => {
  const selected = parseCodexBobPhaseTargetConfig(canonicalJson(config()));
  assert.equal(selected.model, "gpt-5.4");
  assert.equal(selected.reasoning_effort, "xhigh");
  assert.throws(
    () => parseCodexBobPhaseTargetConfig(JSON.stringify(config())),
    /canonical JSON/u,
  );
  const extra = { ...config(), speculative: true };
  assert.throws(
    () => parseCodexBobPhaseTargetConfig(canonicalJson(extra)),
    /fields are/u,
  );
  const externalFixture = structuredClone(config());
  externalFixture.identities.fixture_server.path =
    "/private/tmp/external/server.mjs";
  assert.throws(
    () =>
      parseCodexBobPhaseTargetConfig(canonicalJson(externalFixture)),
    /below the lane root/u,
  );
  const externalAsset = structuredClone(config());
  externalAsset.fixture_assets[0].path =
    "/private/tmp/external/app.mjs";
  assert.throws(
    () =>
      parseCodexBobPhaseTargetConfig(canonicalJson(externalAsset)),
    /below the lane root/u,
  );
  const reorderedAssets = structuredClone(config());
  reorderedAssets.fixture_assets.reverse();
  assert.throws(
    () =>
      parseCodexBobPhaseTargetConfig(canonicalJson(reorderedAssets)),
    /sorted, unique/u,
  );
});

test("validates the non-evidence atomic phase record and its joins", () => {
  const request = inventoryRequest();
  const { authorities, record } = inventoryRecord(request);
  assert.equal(
    validateCodexBobPhaseRecord(record, request, authorities),
    record,
  );

  const changed = structuredClone(record);
  changed.output.surfaces[0].id = "surface_changed";
  assert.throws(
    () => validateCodexBobPhaseRecord(changed, request, authorities),
    /independently adapted authority/u,
  );

  const promoted = structuredClone(record);
  promoted.auth_observation.provider_attestation = "attested";
  assert.throws(
    () => validateCodexBobPhaseRecord(promoted, request, authorities),
    /fixed and non-qualifying/u,
  );

  const statusOnly = structuredClone(record);
  const status = Buffer.from("Logged in using ChatGPT\n", "utf8");
  statusOnly.auth_observation.stderr = {
    bytes: status.length,
    sha256: sha256(status),
  };
  assert.equal(
    validateCodexBobPhaseRecord(statusOnly, request, authorities),
    statusOnly,
  );

  const staleStdoutContract = structuredClone(record);
  staleStdoutContract.auth_observation.stderr = stream(0, "2");
  staleStdoutContract.auth_observation.stdout = {
    bytes: status.length,
    sha256: sha256(status),
  };
  assert.throws(
    () =>
      validateCodexBobPhaseRecord(
        staleStdoutContract,
        request,
        authorities,
      ),
    /streams do not match ChatGPT status/u,
  );

  const duplicateStatus = structuredClone(record);
  const duplicated = Buffer.concat([status, status]);
  duplicateStatus.auth_observation.stderr = {
    bytes: duplicated.length,
    sha256: sha256(duplicated),
  };
  assert.throws(
    () =>
      validateCodexBobPhaseRecord(
        duplicateStatus,
        request,
        authorities,
      ),
    /streams do not match ChatGPT status/u,
  );

  const renamedDiagnostic = structuredClone(record);
  renamedDiagnostic.prompt_input_observation.observation =
    "effective-context-attested";
  assert.throws(
    () =>
      validateCodexBobPhaseRecord(
        renamedDiagnostic,
        request,
        authorities,
      ),
    /fixed and non-qualifying/u,
  );

  for (const mutate of [
    (candidate) => {
      delete candidate.gateway_binding.binding.gateway_policy_sha256;
    },
    (candidate) => {
      candidate.gateway_binding.binding.speculative = true;
    },
    (candidate) => {
      candidate.gateway_binding.binding.calls[0].result_sha256 = digest("6");
    },
    (candidate) => {
      candidate.gateway_binding.binding.gateway_closure_sha256 = digest("7");
    },
    (candidate) => {
      candidate.atomic_receipt.binding.binding_sha256 = digest("8");
    },
    (candidate) => {
      candidate.atomic_receipt.binding.bob_host_binding_sha256 = digest("9");
    },
    (candidate) => {
      candidate.atomic_receipt.binding.thread_id =
        "fedcba98-7654-3210-fedc-ba9876543210";
    },
    (candidate) => {
      candidate.atomic_receipt.binding.codex_final_message_id = "item_99";
    },
    (candidate) => {
      candidate.atomic_receipt.binding.report_sha256 = digest("0");
    },
  ]) {
    const substituted = structuredClone(record);
    mutate(substituted);
    assert.throws(
      () =>
        validateCodexBobPhaseRecord(
          substituted,
          request,
          authorities,
        ),
      /independently derived authority|independently adapted authority/u,
    );
  }
});

test("ships closed bounded output schemas for all three phases", async () => {
  const schemaRoot = join(
    process.cwd(),
    "scripts/evaluation/schemas",
  );
  for (const filename of [
    "codex-bob-interface-inventory-v1.schema.json",
    "codex-bob-expected-use-model-v1.schema.json",
    "codex-bob-task-execution-draft-v1.schema.json",
  ]) {
    const schema = JSON.parse(
      await readFile(join(schemaRoot, filename), "utf8"),
    );
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.ok(Array.isArray(schema.required));
    assert.ok(schema.required.length > 0);
    assert.equal(
      JSON.stringify(schema).includes('"uniqueItems"'),
      false,
      `${filename} must use the OpenAI Structured Outputs schema subset`,
    );
  }
});
