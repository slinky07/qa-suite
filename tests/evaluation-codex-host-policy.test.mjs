import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codexHostPolicySha256,
  createCodexHostPolicy,
  validateCodexHostPolicy,
} from "../scripts/evaluation/codex-host-policy.mjs";
import {
  browserToolsForPhase,
} from "../scripts/evaluation/browser-gateway.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const DIGESTS = {
  codex: "a".repeat(64),
  gateway: "b".repeat(64),
  node: "c".repeat(64),
  outputSchema: "d".repeat(64),
  request: "e".repeat(64),
};
const LANE_ROOT =
  "/private/var/qa-suite/run_0123456789abcdef0123456789abcdef";

function gatewayPolicy(phase = "interface_inventory", overrides = {}) {
  return {
    allowed_paths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    chrome: {
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      sha256: "f".repeat(64),
    },
    evidence_path:
      `QA/evidence/run_0123456789abcdef0123456789abcdef/${phase}`,
    lane_root: LANE_ROOT,
    limits: {
      cdp_timeout_ms: 5000,
      max_artifact_bytes: 32 * 1024 * 1024,
      max_journal_bytes: 2 * 1024 * 1024,
      max_journal_entries: 256,
      max_screenshot_bytes: 2 * 1024 * 1024,
      max_snapshot_bytes: 256 * 1024,
      max_tool_calls: 64,
    },
    phase,
    request_sha256: DIGESTS.request,
    schema_version: 1,
    target_url: "http://127.0.0.1:4173/",
    viewport: {
      device_scale_factor: 1,
      height: 900,
      width: 1280,
    },
    ...overrides,
  };
}

function input(phase = "interface_inventory", overrides = {}) {
  return {
    codex: {
      path: "/opt/homebrew/bin/codex",
      sha256: DIGESTS.codex,
      version: "codex-cli 0.145.0",
    },
    gateway: {
      path: "/controller/scripts/evaluation/browser-gateway.mjs",
      sha256: DIGESTS.gateway,
    },
    gatewayPolicySource: canonicalJson(gatewayPolicy(phase)),
    laneRoot: LANE_ROOT,
    model: "gpt-5.6",
    node: {
      path: "/opt/homebrew/bin/node",
      sha256: DIGESTS.node,
    },
    outputSchema: {
      path: `/controller/schemas/${phase}.json`,
      sha256: DIGESTS.outputSchema,
    },
    phase,
    phaseRequestSha256: DIGESTS.request,
    platform: "darwin",
    reasoningEffort: "high",
    ...overrides,
  };
}

function created(phase = "interface_inventory") {
  return createCodexHostPolicy(input(phase));
}

function mutate(value, path, replacement) {
  const copy = structuredClone(value);
  const segments = path.split(".");
  let cursor = copy;
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = replacement;
  return copy;
}

for (const phase of [
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]) {
  test(`creates the closed ${phase} Codex host policy`, () => {
    const policy = created(phase);
    const expectedTools = browserToolsForPhase(phase).map(({ name }) => name);

    assert.deepEqual(validateCodexHostPolicy(policy), policy);
    assert.deepEqual(policy.gateway.enabled_tools, expectedTools);
    assert.equal(policy.platform, "darwin");
    assert.equal(policy.verification_status, "unverified");
    assert.equal(policy.qualification, "not-evidence");
    assert.equal(policy.result, null);
    assert.equal(policy.invocation.provider, "openai");
    assert.equal(policy.invocation.command_sandbox, "read-only");
    assert.equal(policy.invocation.command_network, "disabled");
    assert.equal(
      policy.invocation.provider_transport,
      "outside-command-sandbox",
    );
    assert.deepEqual(policy.invocation.environment, {
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    });
    assert.deepEqual(
      policy.invocation.arguments.slice(0, 3),
      ["--ask-for-approval", "never", "exec"],
    );
    for (const required of [
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--sandbox",
      "--json",
      "--output-schema",
      "--model",
      "--cd",
      "--skip-git-repo-check",
    ]) {
      assert(policy.invocation.arguments.includes(required), required);
    }
    for (const forbidden of ["resume", "--oss", "--profile"]) {
      assert(!policy.invocation.arguments.includes(forbidden), forbidden);
    }
    for (const contextControl of [
      "project_doc_max_bytes=0",
      "project_doc_fallback_filenames=[]",
      'developer_instructions=""',
    ]) {
      assert(
        policy.invocation.arguments.includes(contextControl),
        contextControl,
      );
    }
    const mcpOverride = policy.invocation.arguments.find(
      (argument) =>
        typeof argument === "string" &&
        argument.startsWith("mcp_servers={"),
    );
    assert.match(mcpOverride, /^mcp_servers=\{bob_browser=\{/u);
    assert.equal(
      (mcpOverride.match(/bob_browser=/gu) ?? []).length,
      1,
    );
    assert.equal(
      codexHostPolicySha256(policy),
      sha256(canonicalJson(policy)),
    );
  });
}

test("rejects unsupported platforms before policy creation", () => {
  assert.throws(
    () => createCodexHostPolicy(input("interface_inventory", {
      platform: "linux",
    })),
    /supports Darwin only/u,
  );
});

test("rejects gateway policy drift from phase, request, and lane", () => {
  for (const gatewayPolicySource of [
    canonicalJson(gatewayPolicy("task_execution")),
    canonicalJson(gatewayPolicy("interface_inventory", {
      request_sha256: "0".repeat(64),
    })),
    canonicalJson(gatewayPolicy("interface_inventory", {
      lane_root: "/private/var/qa-suite/other",
    })),
  ]) {
    assert.throws(
      () => createCodexHostPolicy(input("interface_inventory", {
        gatewayPolicySource,
      })),
      /does not match|lane_root/u,
    );
  }
});

test("rejects identity, provider, context, sandbox, and claim promotion", () => {
  const policy = created();
  const mutations = [
    ["platform", "linux"],
    ["verification_status", "verified"],
    ["qualification", "evidence"],
    ["result", {}],
    ["identities.codex.version", "codex-cli 0.146.0"],
    ["identities.codex.sha256", "invalid"],
    ["identities.codex.path", "codex"],
    ["identities.node.sha256", "invalid"],
    ["invocation.provider", "custom"],
    ["invocation.provider_transport", "inside-command-sandbox"],
    ["invocation.command_network", "enabled"],
    ["invocation.command_sandbox", "workspace-write"],
    ["invocation.session", "resume"],
    ["invocation.model", "bad model"],
    ["invocation.reasoning_effort", "ultra"],
    ["invocation.phase_request_sha256", "0".repeat(64)],
    ["invocation.environment", { ...policy.invocation.environment, PATH: "/bin" }],
    ["claims.provider_identity", "verified"],
    ["claims.state_authentication", "verified"],
    ["gateway.alias", "other"],
    ["gateway.required", false],
    ["gateway.default_tools_approval_mode", "auto"],
    ["gateway.enabled_tools", [...policy.gateway.enabled_tools, "shell"]],
    ["gateway.policy_sha256", "0".repeat(64)],
  ];
  for (const [path, replacement] of mutations) {
    assert.throws(
      () => validateCodexHostPolicy(mutate(policy, path, replacement)),
      Error,
      path,
    );
  }
});

test("rejects missing, extra, reordered, sparse, and substituted launch data", () => {
  const policy = created();
  const extra = structuredClone(policy);
  extra.unexpected = true;
  assert.throws(() => validateCodexHostPolicy(extra), /fields are/u);

  const missing = structuredClone(policy);
  delete missing.gateway.policy_sha256;
  assert.throws(() => validateCodexHostPolicy(missing), /fields are/u);

  const reordered = structuredClone(policy);
  [
    reordered.invocation.arguments[3],
    reordered.invocation.arguments[4],
  ] = [
    reordered.invocation.arguments[4],
    reordered.invocation.arguments[3],
  ];
  assert.throws(
    () => validateCodexHostPolicy(reordered),
    /arguments does not match/u,
  );

  const substituted = structuredClone(policy);
  substituted.invocation.arguments[
    substituted.invocation.arguments.indexOf("read-only")
  ] = "danger-full-access";
  assert.throws(
    () => validateCodexHostPolicy(substituted),
    /arguments does not match/u,
  );

  const gitCheckRequired = structuredClone(policy);
  gitCheckRequired.invocation.arguments.splice(
    gitCheckRequired.invocation.arguments.indexOf("--skip-git-repo-check"),
    1,
  );
  assert.throws(
    () => validateCodexHostPolicy(gitCheckRequired),
    /arguments must contain exactly|arguments does not match/u,
  );

  const sparse = structuredClone(policy);
  delete sparse.invocation.arguments[5];
  assert.throws(
    () => validateCodexHostPolicy(sparse),
    /must be dense/u,
  );

  const named = structuredClone(policy);
  named.invocation.arguments.extra = "resume";
  assert.throws(
    () => validateCodexHostPolicy(named),
    /must not contain named properties/u,
  );
});

test("rejects gateway source substitution even when its digest is updated", () => {
  const policy = created();
  const substitutedSource = canonicalJson(gatewayPolicy(
    "interface_inventory",
    { target_url: "http://127.0.0.1:4174/" },
  ));
  const substituted = mutate(
    policy,
    "gateway.policy_source",
    substitutedSource,
  );
  substituted.gateway.policy_sha256 = sha256(substitutedSource);
  assert.throws(
    () => validateCodexHostPolicy(substituted),
    /arguments does not match/u,
  );
});
