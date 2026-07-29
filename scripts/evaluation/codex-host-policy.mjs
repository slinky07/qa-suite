import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  browserToolsForPhase,
  parseBrowserGatewayPolicy,
} from "./browser-gateway.mjs";
import {
  canonicalJson,
  sha256,
} from "./contracts.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PHASES = new Set([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
]);
const DISABLED_FEATURES = Object.freeze([
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode_host",
  "computer_use",
  "goals",
  "guardian_approval",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "plugin_sharing",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "workspace_dependencies",
]);
const FIXED_ENVIRONMENT = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});
const FIXED_CLAIMS = Object.freeze({
  command_environment: "fixed-requested",
  command_network: "disabled-requested",
  command_sandbox: "read-only-requested",
  context_isolation: "fresh-process-requested-not-attested",
  effective_tool_inventory: "closed-requested-not-attested",
  model_identity: "requested-not-attested",
  provider_identity: "openai-requested-not-provider-attested",
  state_authentication: "not-attested",
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

function assertDenseArray(value, expectedLength, label) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be dense`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    throw new Error(`${label} must not contain named properties`);
  }
}

function assertString(
  value,
  label,
  { maximum = 4096, pattern, trimmed = true } = {},
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (trimmed && value.trim() !== value) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maximum ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertDigest(value, label) {
  return assertString(value, label, {
    maximum: 64,
    pattern: SHA256,
  });
}

function assertAbsolutePath(value, label) {
  assertString(value, label, { maximum: 4096 });
  if (!isAbsolute(value) || resolve(value) !== value) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function assertDescendant(parent, child, label) {
  const path = relative(parent, child);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`${label} must be below the lane root`);
  }
}

function assertCanonicalEqual(observed, expected, label) {
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match the closed host policy`);
  }
}

function measuredIdentity(value, label, version = false) {
  const expected = version
    ? ["path", "sha256", "version"]
    : ["path", "sha256"];
  assertExactKeys(value, expected, label);
  const identity = {
    path: assertAbsolutePath(value.path, `${label}.path`),
    sha256: assertDigest(value.sha256, `${label}.sha256`),
  };
  if (version) {
    if (value.version !== "codex-cli 0.145.0") {
      throw new Error(`${label}.version must equal codex-cli 0.145.0`);
    }
    identity.version = value.version;
  }
  return identity;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlStringArray(values) {
  return `[${values.map((value) => tomlString(value)).join(",")}]`;
}

function gatewayConfig(policy) {
  const gateway = policy.gateway;
  return [
    "mcp_servers={bob_browser={",
    `command=${tomlString(policy.identities.node.path)},`,
    `args=${tomlStringArray([policy.identities.gateway.path])},`,
    `cwd=${tomlString(policy.invocation.lane_root)},`,
    "required=true,",
    `enabled_tools=${tomlStringArray(gateway.enabled_tools)},`,
    "disabled_tools=[],",
    "default_tools_approval_mode=\"approve\",",
    `startup_timeout_sec=${gateway.startup_timeout_sec},`,
    `tool_timeout_sec=${gateway.tool_timeout_sec},`,
    "env={QA_SUITE_BROWSER_POLICY=",
    `${tomlString(gateway.policy_source)}}}}`,
  ].join("");
}

function expectedArguments(policy) {
  const arguments_ = [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--sandbox",
    "read-only",
    "--json",
    "--output-schema",
    policy.identities.output_schema.path,
    "--model",
    policy.invocation.model,
    "--cd",
    policy.invocation.lane_root,
    "--skip-git-repo-check",
    "--color",
    "never",
  ];
  for (const feature of DISABLED_FEATURES) {
    arguments_.push("--disable", feature);
  }
  arguments_.push(
    "--config",
    'model_provider="openai"',
    "--config",
    `model_reasoning_effort=${tomlString(
      policy.invocation.reasoning_effort,
    )}`,
    "--config",
    'web_search="disabled"',
    "--config",
    'shell_environment_policy.inherit="none"',
    "--config",
    'shell_environment_policy.include_only=["LANG","LC_ALL","TZ"]',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    "project_doc_fallback_filenames=[]",
    "--config",
    'developer_instructions=""',
    "--config",
    gatewayConfig(policy),
    "-",
  );
  return arguments_;
}

function phaseToolNames(phase) {
  return browserToolsForPhase(phase).map(({ name }) => name);
}

function validateClaims(value) {
  assertExactKeys(
    value,
    Object.keys(FIXED_CLAIMS),
    "Codex host policy.claims",
  );
  assertCanonicalEqual(value, FIXED_CLAIMS, "Codex host policy.claims");
  return structuredClone(value);
}

function validateGateway(value, invocation) {
  assertExactKeys(
    value,
    [
      "alias",
      "default_tools_approval_mode",
      "enabled_tools",
      "policy_sha256",
      "policy_source",
      "required",
      "startup_timeout_sec",
      "tool_timeout_sec",
    ],
    "Codex host policy.gateway",
  );
  if (
    value.alias !== "bob_browser" ||
    value.default_tools_approval_mode !== "approve" ||
    value.required !== true ||
    value.startup_timeout_sec !== 10 ||
    value.tool_timeout_sec !== 60
  ) {
    throw new Error("Codex host policy gateway settings are invalid");
  }
  const expectedTools = phaseToolNames(invocation.phase);
  assertDenseArray(
    value.enabled_tools,
    expectedTools.length,
    "Codex host policy.gateway.enabled_tools",
  );
  assertCanonicalEqual(
    value.enabled_tools,
    expectedTools,
    "Codex host policy.gateway.enabled_tools",
  );
  assertString(
    value.policy_source,
    "Codex host policy.gateway.policy_source",
    { maximum: 64 * 1024, trimmed: false },
  );
  if (value.policy_sha256 !== sha256(value.policy_source)) {
    throw new Error("Codex host policy gateway policy digest does not match");
  }
  const browserPolicy = parseBrowserGatewayPolicy(value.policy_source);
  if (
    browserPolicy.phase !== invocation.phase ||
    browserPolicy.request_sha256 !== invocation.phase_request_sha256 ||
    browserPolicy.lane_root !== invocation.lane_root
  ) {
    throw new Error(
      "Codex host policy gateway policy does not match the invocation",
    );
  }
  const evidenceRoot = resolve(
    browserPolicy.lane_root,
    browserPolicy.evidence_path,
  );
  assertDescendant(
    browserPolicy.lane_root,
    evidenceRoot,
    "browser gateway evidence root",
  );
  if (evidenceRoot !== invocation.evidence_root) {
    throw new Error(
      "Codex host policy evidence root does not match the gateway policy",
    );
  }
  return structuredClone(value);
}

function validateIdentities(value) {
  assertExactKeys(
    value,
    ["codex", "gateway", "node", "output_schema"],
    "Codex host policy.identities",
  );
  return {
    codex: measuredIdentity(value.codex, "Codex identity", true),
    gateway: measuredIdentity(value.gateway, "browser gateway identity"),
    node: measuredIdentity(value.node, "Node identity"),
    output_schema: measuredIdentity(
      value.output_schema,
      "output schema identity",
    ),
  };
}

function validateInvocation(value) {
  assertExactKeys(
    value,
    [
      "arguments",
      "command_network",
      "command_sandbox",
      "environment",
      "evidence_root",
      "lane_root",
      "model",
      "phase",
      "phase_request_sha256",
      "provider",
      "provider_transport",
      "reasoning_effort",
      "session",
    ],
    "Codex host policy.invocation",
  );
  if (
    value.command_network !== "disabled" ||
    value.command_sandbox !== "read-only" ||
    value.provider !== "openai" ||
    value.provider_transport !== "outside-command-sandbox" ||
    value.session !== "new-ephemeral-process"
  ) {
    throw new Error("Codex host policy invocation boundary is invalid");
  }
  if (!PHASES.has(value.phase)) {
    throw new Error("Codex host policy invocation phase is invalid");
  }
  assertString(value.model, "Codex host policy invocation model", {
    maximum: 128,
    pattern: SAFE_NAME,
  });
  if (!REASONING_EFFORTS.has(value.reasoning_effort)) {
    throw new Error("Codex host policy reasoning effort is invalid");
  }
  assertDigest(
    value.phase_request_sha256,
    "Codex host policy phase request digest",
  );
  assertAbsolutePath(value.lane_root, "Codex host policy lane root");
  assertAbsolutePath(value.evidence_root, "Codex host policy evidence root");
  assertDescendant(
    value.lane_root,
    value.evidence_root,
    "Codex host policy evidence root",
  );
  assertExactKeys(
    value.environment,
    Object.keys(FIXED_ENVIRONMENT),
    "Codex host policy invocation environment",
  );
  assertCanonicalEqual(
    value.environment,
    FIXED_ENVIRONMENT,
    "Codex host policy invocation environment",
  );
  if (!Array.isArray(value.arguments)) {
    throw new Error("Codex host policy invocation arguments must be an array");
  }
  assertDenseArray(
    value.arguments,
    value.arguments.length,
    "Codex host policy invocation arguments",
  );
  return {
    ...structuredClone(value),
    arguments: [...value.arguments],
  };
}

export function validateCodexHostPolicy(value) {
  assertExactKeys(
    value,
    [
      "claims",
      "gateway",
      "identities",
      "invocation",
      "platform",
      "qualification",
      "result",
      "schema_version",
      "verification_status",
    ],
    "Codex host policy",
  );
  if (
    value.schema_version !== 1 ||
    value.platform !== "darwin" ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error("Codex host policy must remain Darwin-only non-evidence");
  }
  const identities = validateIdentities(value.identities);
  const invocation = validateInvocation(value.invocation);
  const policy = {
    claims: validateClaims(value.claims),
    gateway: validateGateway(value.gateway, invocation),
    identities,
    invocation,
    platform: "darwin",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
  const arguments_ = expectedArguments(policy);
  assertDenseArray(
    policy.invocation.arguments,
    arguments_.length,
    "Codex host policy invocation arguments",
  );
  assertCanonicalEqual(
    policy.invocation.arguments,
    arguments_,
    "Codex host policy invocation arguments",
  );
  return policy;
}

export function createCodexHostPolicy({
  codex,
  gateway,
  gatewayPolicySource,
  laneRoot,
  model,
  node,
  outputSchema,
  phase,
  phaseRequestSha256,
  platform = process.platform,
  reasoningEffort,
}) {
  if (platform !== "darwin") {
    throw new Error("Codex Bob host policy supports Darwin only");
  }
  const identities = validateIdentities({
    codex,
    gateway,
    node,
    output_schema: outputSchema,
  });
  const browserPolicy = parseBrowserGatewayPolicy(gatewayPolicySource);
  const evidenceRoot = resolve(
    assertAbsolutePath(laneRoot, "Codex host policy lane root"),
    browserPolicy.evidence_path,
  );
  const policy = {
    claims: structuredClone(FIXED_CLAIMS),
    gateway: {
      alias: "bob_browser",
      default_tools_approval_mode: "approve",
      enabled_tools: phaseToolNames(phase),
      policy_sha256: sha256(gatewayPolicySource),
      policy_source: gatewayPolicySource,
      required: true,
      startup_timeout_sec: 10,
      tool_timeout_sec: 60,
    },
    identities,
    invocation: {
      arguments: [],
      command_network: "disabled",
      command_sandbox: "read-only",
      environment: structuredClone(FIXED_ENVIRONMENT),
      evidence_root: evidenceRoot,
      lane_root: laneRoot,
      model,
      phase,
      phase_request_sha256: phaseRequestSha256,
      provider: "openai",
      provider_transport: "outside-command-sandbox",
      reasoning_effort: reasoningEffort,
      session: "new-ephemeral-process",
    },
    platform: "darwin",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
  policy.invocation.arguments = expectedArguments(policy);
  return validateCodexHostPolicy(policy);
}

export function codexHostPolicySha256(value) {
  return sha256(canonicalJson(validateCodexHostPolicy(value)));
}
