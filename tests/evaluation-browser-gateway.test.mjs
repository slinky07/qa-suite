import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  assertBrowserProcessGroupSupport,
  BrowserGateway,
  CdpPipeClient,
  EvidenceStore,
  browserToolsForPhase,
  parseBrowserGatewayPolicy,
  removeBrowserProfileIfSafe,
  serveBrowserGatewayMcp,
  terminateProcessGroup,
  validateBrowserGatewayClosure,
  validateBrowserGatewayPolicy,
} from "../scripts/evaluation/browser-gateway.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const DIGEST = "a".repeat(64);

function policy(overrides = {}) {
  return {
    allowed_paths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    chrome: {
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      sha256: DIGEST,
    },
    evidence_path:
      "QA/evidence/run_0123456789abcdef0123456789abcdef/interface_inventory",
    lane_root: "/private/var/qa-suite/run_0123456789abcdef0123456789abcdef",
    limits: {
      cdp_timeout_ms: 5000,
      max_artifact_bytes: 32 * 1024 * 1024,
      max_journal_bytes: 2 * 1024 * 1024,
      max_journal_entries: 256,
      max_screenshot_bytes: 2 * 1024 * 1024,
      max_snapshot_bytes: 256 * 1024,
      max_tool_calls: 64,
    },
    phase: "interface_inventory",
    request_sha256: "b".repeat(64),
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

function responseLines(stream) {
  let source = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    source += chunk;
  });
  return () =>
    source
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
}

function browserIdentity(overrides = {}) {
  return {
    arguments_sha256: DIGEST,
    executable_sha256: DIGEST,
    js_version: "15.0",
    product: "Chrome/150.0",
    protocol_version: "1.3",
    revision: "@revision",
    stderr_bytes: 0,
    stderr_sha256: DIGEST,
    user_agent: "Chrome",
    ...overrides,
  };
}

function closure(overrides = {}) {
  return {
    browser: browserIdentity(),
    journal: {
      bytes: 1024,
      entries: 3,
      last_sha256: DIGEST,
      path: "QA/evidence/run/gateway-journal.jsonl",
    },
    policy_sha256: DIGEST,
    qualification: "not-evidence",
    request_sha256: DIGEST,
    result: null,
    schema_version: 1,
    source_sha256: DIGEST,
    status: "closed",
    tools_sha256: sha256(
      canonicalJson(browserToolsForPhase("interface_inventory")),
    ),
    verification_status: "unverified",
    violations: [],
    ...overrides,
  };
}

function control({
  checked,
  disabled = false,
  id = "control_query",
  nodeId = 20,
  role = "textbox",
  tag = "input",
  type = "text",
} = {}) {
  return {
    backendNodeId: 1000 + nodeId,
    checked,
    disabled,
    id,
    nodeId,
    role,
    tag,
    type,
    y: 20 + (nodeId - 20) * 60,
  };
}

function fakeCdp(controls = [control()]) {
  const calls = [];
  const controlsByNode = new Map(controls.map((item) => [item.nodeId, item]));
  return {
    calls,
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "DOM.getDocument") {
        return { root: { nodeId: 1 } };
      }
      if (method === "DOM.querySelectorAll") {
        if (params.nodeId === 1 && params.selector === "[data-surface-id]") {
          return { nodeIds: [10] };
        }
        if (params.nodeId === 10 && params.selector === "[data-control-id]") {
          return { nodeIds: controls.map(({ nodeId }) => nodeId) };
        }
        if (params.selector === "option") return { nodeIds: [] };
      }
      if (method === "DOM.describeNode" && params.nodeId === 10) {
        return {
          node: {
            attributes: ["data-surface-id", "surface_search"],
          },
        };
      }
      if (method === "DOM.describeNode") {
        const item = controlsByNode.get(params.nodeId);
        if (!item) throw new Error(`unknown fake node ${params.nodeId}`);
        return {
          node: {
            attributes: [
              "data-control-id",
              item.id,
              ...(item.tag === "input" ? ["type", item.type] : []),
            ],
            backendNodeId: item.backendNodeId,
            localName: item.tag,
          },
        };
      }
      if (method === "DOM.getBoxModel") {
        const item = controlsByNode.get(params.nodeId);
        if (!item) throw new Error(`unknown fake node ${params.nodeId}`);
        return {
          model: {
            border: [
              10,
              item.y,
              110,
              item.y,
              110,
              item.y + 40,
              10,
              item.y + 40,
            ],
          },
        };
      }
      if (method === "DOM.getNodeForLocation") {
        const item = controls.find(
          ({ y }) =>
            params.x >= 10 &&
            params.x <= 110 &&
            params.y >= y &&
            params.y <= y + 40,
        );
        return item
          ? { backendNodeId: item.backendNodeId, nodeId: item.nodeId }
          : {};
      }
      if (method === "Accessibility.getPartialAXTree") {
        const item = controlsByNode.get(params.nodeId);
        const properties = [
          { name: "disabled", value: { value: item.disabled } },
          { name: "focusable", value: { value: true } },
          { name: "required", value: { value: false } },
        ];
        if (item.checked !== undefined) {
          properties.push({
            name: "checked",
            value: { value: item.checked },
          });
        }
        return {
          nodes: [{
            backendDOMNodeId: item.backendNodeId,
            ignored: false,
            name: { value: "Search query" },
            properties,
            role: { value: item.role },
            value: { value: "" },
          }],
        };
      }
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              ignored: false,
              name: { value: "Project Finder" },
              role: { value: "heading" },
            },
            {
              ignored: false,
              name: { value: "Find a project" },
              role: { value: "StaticText" },
            },
          ],
        };
      }
      if (method === "Page.getNavigationHistory") {
        return {
          currentIndex: 0,
          entries: [{
            title: "Project Finder",
            url: "http://127.0.0.1:4173/",
          }],
        };
      }
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: {
            pageX: 0,
            pageY: 0,
          },
        };
      }
      if (
        [
          "DOM.focus",
          "DOM.scrollIntoViewIfNeeded",
          "Input.dispatchKeyEvent",
          "Input.dispatchMouseEvent",
          "Input.insertText",
        ].includes(method)
      ) {
        return {};
      }
      throw new Error(`unexpected fake CDP method ${method}`);
    },
  };
}

function fakeEvidence() {
  const artifacts = [];
  const records = [];
  return {
    artifacts,
    beginToolCall() {},
    async artifact(kind, extension, bytes) {
      const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const artifact = {
        bytes: content.length,
        path: `QA/evidence/run/${String(artifacts.length + 1).padStart(4, "0")}-${kind}.${extension}`,
        sha256: sha256(content),
      };
      artifacts.push({ artifact, kind });
      return artifact;
    },
    async record(event, payload) {
      records.push({ event, payload });
    },
    records,
  };
}

function gatewayWith({ controls, evidence = fakeEvidence() } = {}) {
  const cdp = fakeCdp(controls);
  return {
    cdp,
    evidence,
    gateway: new BrowserGateway({
      browser: {},
      cdp,
      evidence,
      policy: policy({ phase: "task_execution" }),
      sessionId: "session-1",
    }),
  };
}

test("browser policy is strict, canonical, and loopback-only", () => {
  const value = policy();

  assert.deepEqual(validateBrowserGatewayPolicy(value), value);
  assert.deepEqual(
    parseBrowserGatewayPolicy(canonicalJson(value)),
    value,
  );
  assert.throws(
    () => parseBrowserGatewayPolicy(JSON.stringify(value)),
    /canonical JSON/u,
  );

  const invalid = [
    { ...value, extra: true },
    { ...value, phase: "smoke" },
    { ...value, target_url: "http://localhost:4173/" },
    { ...value, target_url: "https://127.0.0.1:4173/" },
    { ...value, target_url: "http://127.0.0.1:4173/?case=1" },
    { ...value, allowed_paths: ["/", "/app.mjs", "/app.mjs"] },
    { ...value, allowed_paths: ["/app.mjs", "/"] },
    { ...value, allowed_paths: ["/app.mjs"] },
    { ...value, evidence_path: "QA/../oracle" },
    { ...value, evidence_path: "/QA/evidence/run" },
    {
      ...value,
      chrome: { ...value.chrome, path: "Google Chrome" },
    },
    {
      ...value,
      viewport: { ...value.viewport, width: 100 },
    },
    {
      ...value,
      limits: { ...value.limits, max_journal_bytes: 1024 },
    },
  ];
  for (const candidate of invalid) {
    assert.throws(() => validateBrowserGatewayPolicy(candidate));
  }
});

test("phase tool inventories are exact and action-gated", () => {
  for (const phase of ["interface_inventory", "expected_use_model"]) {
    assert.deepEqual(
      browserToolsForPhase(phase).map(({ name }) => name),
      ["observe_page", "capture_screenshot"],
    );
  }
  const taskTools = browserToolsForPhase("task_execution");
  assert.deepEqual(
    taskTools.map(({ name }) => name),
    [
      "observe_page",
      "capture_screenshot",
      "set_control",
      "activate_control",
    ],
  );
  for (const tool of taskTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.throws(() => browserToolsForPhase("unknown"));
});

test("CDP pipe correlates partial and out-of-order NUL frames", async () => {
  const browserToController = new PassThrough();
  const controllerToBrowser = new PassThrough();
  const requests = [];
  controllerToBrowser.on("data", (chunk) => {
    requests.push(...chunk.toString("utf8").split("\0").filter(Boolean));
  });
  const client = new CdpPipeClient({
    input: browserToController,
    output: controllerToBrowser,
    timeoutMs: 1000,
  });

  const first = client.send("Browser.getVersion");
  const second = client.send(
    "Page.navigate",
    { url: "http://127.0.0.1:4173/" },
    "session-1",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(requests[0]), {
    id: 1,
    method: "Browser.getVersion",
    params: {},
  });
  assert.deepEqual(JSON.parse(requests[1]), {
    id: 2,
    method: "Page.navigate",
    params: { url: "http://127.0.0.1:4173/" },
    sessionId: "session-1",
  });

  const frames = Buffer.from(
    `${JSON.stringify({ id: 2, result: { frameId: "frame-1" } })}\0` +
    `${JSON.stringify({ id: 1, result: { product: "Chrome" } })}\0`,
    "utf8",
  );
  browserToController.write(frames.subarray(0, 17));
  browserToController.write(frames.subarray(17));

  assert.deepEqual(await second, { frameId: "frame-1" });
  assert.deepEqual(await first, { product: "Chrome" });
  client.close();
});

test("browser cleanup never signals a stale process-group ID", async () => {
  const calls = [];
  const processGroup = {
    signal(pid, signal) {
      calls.push({ pid, signal });
    },
    async waitForEmpty(pid, timeoutMs) {
      calls.push({ pid, timeoutMs });
      return true;
    },
  };

  await assert.rejects(
    () =>
      terminateProcessGroup({
        exitCode: 0,
        pid: 101,
        signalCode: null,
      }, processGroup),
    /leader exited/u,
  );

  assert.deepEqual(calls, []);
});

test("browser cleanup fails closed on unsupported process groups", async () => {
  assert.throws(
    () => assertBrowserProcessGroupSupport("win32"),
    /unsupported on win32/u,
  );

  await assert.rejects(
    () =>
      terminateProcessGroup({
        exitCode: null,
        pid: 106,
        signalCode: null,
      }, {
        platform: "win32",
        signal() {
          assert.fail("unsupported process group was signaled");
        },
        async waitForEmpty() {
          assert.fail("unsupported process group was probed");
        },
      }),
    /unsupported on win32/u,
  );
});

test("browser cleanup proves its live process group empty after SIGTERM", async () => {
  const calls = [];
  const processGroup = {
    signal(pid, signal) {
      calls.push({ pid, signal });
    },
    async waitForEmpty(pid, timeoutMs) {
      calls.push({ pid, timeoutMs });
      return true;
    },
  };

  await terminateProcessGroup({
    exitCode: null,
    pid: 102,
    signalCode: null,
  }, processGroup);

  assert.deepEqual(calls, [
    { pid: 102, signal: "SIGTERM" },
    { pid: 102, timeoutMs: 1500 },
  ]);
});

test("browser cleanup never escalates after the leader exits", async () => {
  const calls = [];
  const child = {
    exitCode: null,
    pid: 103,
    signalCode: null,
  };
  const processGroup = {
    signal(pid, signal) {
      calls.push({ pid, signal });
    },
    async waitForEmpty(pid, timeoutMs) {
      calls.push({ pid, timeoutMs });
      child.exitCode = 0;
      return false;
    },
  };

  await assert.rejects(
    () => terminateProcessGroup(child, processGroup),
    /leader exited/u,
  );

  assert.deepEqual(calls, [
    { pid: 103, signal: "SIGTERM" },
    { pid: 103, timeoutMs: 1500 },
  ]);
});

test("browser cleanup escalates while the owned leader remains live", async () => {
  const calls = [];
  const emptyResults = [false, true];
  const processGroup = {
    signal(pid, signal) {
      calls.push({ pid, signal });
    },
    async waitForEmpty(pid, timeoutMs) {
      calls.push({ pid, timeoutMs });
      return emptyResults.shift();
    },
  };

  await terminateProcessGroup({
    exitCode: null,
    pid: 104,
    signalCode: null,
  }, processGroup);

  assert.deepEqual(calls, [
    { pid: 104, signal: "SIGTERM" },
    { pid: 104, timeoutMs: 1500 },
    { pid: 104, signal: "SIGKILL" },
    { pid: 104, timeoutMs: 500 },
  ]);
});

test("browser cleanup fails when the owned group remains present", async () => {
  const calls = [];
  const processGroup = {
    signal(pid, signal) {
      calls.push({ pid, signal });
    },
    async waitForEmpty(pid, timeoutMs) {
      calls.push({ pid, timeoutMs });
      return false;
    },
  };

  await assert.rejects(
    () =>
      terminateProcessGroup({
        exitCode: null,
        pid: 105,
        signalCode: null,
      }, processGroup),
    /process group did not become empty/u,
  );

  assert.deepEqual(calls, [
    { pid: 105, signal: "SIGTERM" },
    { pid: 105, timeoutMs: 1500 },
    { pid: 105, signal: "SIGKILL" },
    { pid: 105, timeoutMs: 500 },
  ]);
});

test("browser profile removal requires a proven-empty process group", async () => {
  const calls = [];
  const profileRemoved = await removeBrowserProfileIfSafe({
    processGroupEmpty: false,
    profile: "/tmp/qa-suite-browser-test",
    removeProfile(path, options) {
      calls.push({ options, path });
    },
  });

  assert.equal(profileRemoved, false);
  assert.deepEqual(calls, []);
});

test("browser profile removal follows a proven-empty process group", async () => {
  const calls = [];
  const profileRemoved = await removeBrowserProfileIfSafe({
    processGroupEmpty: true,
    profile: "/tmp/qa-suite-browser-test",
    removeProfile(path, options) {
      calls.push({ options, path });
    },
  });

  assert.equal(profileRemoved, true);
  assert.deepEqual(calls, [{
    options: { force: true, recursive: true },
    path: "/tmp/qa-suite-browser-test",
  }]);
});

test("all browser closure paths gate profile removal", async () => {
  const source = await readFile(
    new URL("../scripts/evaluation/browser-gateway.mjs", import.meta.url),
    "utf8",
  );
  const gatedRemovalCalls =
    source.match(/await removeBrowserProfileIfSafe\(\{/gu) ?? [];

  assert.equal(gatedRemovalCalls.length, 2);
  assert.doesNotMatch(source, /await rm\(profile,/u);
});

test("CDP pipe routes flattened events and fails on unknown responses", async () => {
  const browserToController = new PassThrough();
  const controllerToBrowser = new PassThrough();
  const client = new CdpPipeClient({
    input: browserToController,
    output: controllerToBrowser,
    timeoutMs: 1000,
  });
  const events = [];
  client.on("Page.loadEventFired", (params, sessionId) => {
    events.push({ params, sessionId });
  });

  browserToController.write(
    Buffer.from(
      `${JSON.stringify({
        method: "Page.loadEventFired",
        params: { timestamp: 1 },
        sessionId: "session-1",
      })}\0`,
      "utf8",
    ),
  );
  assert.deepEqual(events, [{
    params: { timestamp: 1 },
    sessionId: "session-1",
  }]);

  browserToController.write(
    Buffer.from(`${JSON.stringify({ id: 999, result: {} })}\0`, "utf8"),
  );
  await assert.rejects(
    () => client.send("Browser.getVersion"),
    /closed/u,
  );
});

test("MCP lifecycle exposes exact tools and canonical tool output", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const readResponses = responseLines(output);
  const calls = [];
  const gateway = {
    async callTool(name, args) {
      calls.push({ args, name });
      return {
        result: {
          artifact: {
            path: "QA/evidence/run/snapshot.json",
            sha256: DIGEST,
          },
          schema_version: 1,
        },
      };
    },
    listTools() {
      return browserToolsForPhase("interface_inventory");
    },
  };
  const serving = serveBrowserGatewayMcp({ gateway, input, output });

  input.write(`${JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
      protocolVersion: "2025-06-18",
    },
  })}\n`);
  input.write(`${JSON.stringify({
    id: 2,
    jsonrpc: "2.0",
    method: "ping",
  })}\n`);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  })}\n`);
  input.write(`${JSON.stringify({
    id: 3,
    jsonrpc: "2.0",
    method: "tools/list",
    params: {
      _meta: {
        progressToken: "tools-list",
      },
    },
  })}\n`);
  input.write(`${JSON.stringify({
    id: 4,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: {
        progressToken: "tools-call",
      },
      arguments: {},
      name: "observe_page",
    },
  })}\n`);
  input.end();
  await serving;

  const responses = readResponses();
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(responses[1].result, {});
  assert.deepEqual(
    responses[2].result.tools.map(({ name }) => name),
    ["observe_page", "capture_screenshot"],
  );
  assert.equal(responses[3].result.isError, false);
  assert.deepEqual(
    JSON.parse(responses[3].result.content[0].text),
    {
      artifact: {
        path: "QA/evidence/run/snapshot.json",
        sha256: DIGEST,
      },
      schema_version: 1,
    },
  );
  assert.equal(
    canonicalJson(calls),
    canonicalJson([{ args: {}, name: "observe_page" }]),
  );
});

test("MCP malformed requests return errors without ending the server", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const readResponses = responseLines(output);
  const gateway = {
    async callTool() {
      throw new Error("not called");
    },
    listTools() {
      return [];
    },
  };
  const serving = serveBrowserGatewayMcp({ gateway, input, output });

  input.write(
    '{"jsonrpc":"2.0","id":1,"id":2,"method":"initialize","params":{}}\n',
  );
  input.write(`${JSON.stringify({
    id: 2,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
      protocolVersion: "unsupported",
    },
  })}\n`);
  input.write(`${JSON.stringify({
    id: 3,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
      protocolVersion: "2025-06-18",
    },
  })}\n`);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  })}\n`);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/unsupported",
  })}\n`);
  input.write(`${JSON.stringify({
    id: 4,
    jsonrpc: "2.0",
    method: "tools/list",
    params: { _meta: [] },
  })}\n`);
  input.write(`${JSON.stringify({
    id: 5,
    jsonrpc: "2.0",
    method: "tools/list",
    params: { _meta: {}, cursor: "unsupported" },
  })}\n`);
  input.write(`${JSON.stringify({
    id: 6,
    jsonrpc: "2.0",
    method: "unknown",
  })}\n`);
  input.end();
  await serving;

  const responses = readResponses();
  assert.equal(responses[0].error.code, -32600);
  assert.match(responses[1].error.message, /unsupported/u);
  assert.equal(responses[2].result.serverInfo.name, "qa-suite-browser-gateway");
  assert.match(responses[3].error.message, /must be an object/u);
  assert.match(responses[4].error.message, /fields are/u);
  assert.equal(responses[5].error.code, -32601);
});

test("MCP input has a global message budget", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const serving = serveBrowserGatewayMcp({
    gateway: {
      async callTool() {
        throw new Error("not called");
      },
      listTools() {
        return [];
      },
    },
    input,
    output,
  });

  input.end("\n".repeat(513));

  await assert.rejects(serving, /message limit/u);
});

test("gateway rejects action tools and URL escapes before CDP use", async () => {
  const records = [];
  const gateway = new BrowserGateway({
    browser: {},
    cdp: {
      send() {
        throw new Error("CDP must not be called");
      },
    },
    evidence: {
      async record(event, payload) {
        records.push({ event, payload });
      },
    },
    policy: policy(),
    sessionId: "session-1",
  });

  await assert.rejects(
    () =>
      gateway.callTool("set_control", {
        control_id: "control_title",
        value: "value",
      }),
    /unavailable/u,
  );
  await assert.rejects(
    () => gateway.callTool("observe_page", { selector: "*" }),
    /fields/u,
  );
  assert.equal(gateway.isAllowedUrl("http://127.0.0.1:4173/app.mjs"), true);
  for (const value of [
    "http://127.0.0.1.evil:4173/",
    "http://127.0.0.1:4174/",
    "https://127.0.0.1:4173/",
    "file:///etc/passwd",
    "http://127.0.0.1:4173/secret",
    "http://user@127.0.0.1:4173/",
  ]) {
    assert.equal(gateway.isAllowedUrl(value), false);
  }
  assert.deepEqual(
    records.map(({ event }) => event),
    ["tool_failed", "tool_failed"],
  );
});

test("fake CDP yields an exact bounded semantic inventory", async () => {
  const checkbox = control({
    checked: "false",
    id: "control_include_archived",
    role: "checkbox",
    type: "checkbox",
  });
  const { evidence, gateway } = gatewayWith({ controls: [checkbox] });

  const observed = await gateway.observePage();

  assert.deepEqual(observed, {
    artifact: evidence.artifacts[0].artifact,
    console: [],
    controls: [{
      bounds: { height: 40, width: 100, x: 10, y: 20 },
      id: "control_include_archived",
      name: "Search query",
      role: "checkbox",
      state: {
        checked: false,
        disabled: false,
        expanded: null,
        focusable: true,
        required: false,
      },
      surface_id: "surface_search",
      tag: "input",
      type: "checkbox",
      value: "",
    }],
    headings: ["Project Finder"],
    schema_version: 1,
    surfaces: [{
      control_ids: ["control_include_archived"],
      id: "surface_search",
    }],
    title: "Project Finder",
    url: "http://127.0.0.1:4173/",
    viewport: {
      device_scale_factor: 1,
      height: 900,
      width: 1280,
    },
    visible_text: ["Find a project"],
  });
});

test("duplicate controls and unavailable actions fail closed", async () => {
  const duplicated = gatewayWith({
    controls: [
      control({ id: "control_duplicate", nodeId: 20 }),
      control({ id: "control_duplicate", nodeId: 21 }),
    ],
  });
  await assert.rejects(
    () => duplicated.gateway.observePage(),
    /duplicated/u,
  );

  const restricted = gatewayWith({
    controls: [
      control({
        disabled: true,
        id: "control_disabled",
        nodeId: 20,
        role: "button",
        tag: "button",
        type: "button",
      }),
      control({
        id: "control_unsupported",
        nodeId: 21,
        role: "button",
        tag: "button",
        type: "button",
      }),
    ],
  });
  await assert.rejects(
    () =>
      restricted.gateway.callTool("activate_control", {
        control_id: "control_disabled",
      }),
    /not currently actionable/u,
  );
  await assert.rejects(
    () =>
      restricted.gateway.callTool("set_control", {
        control_id: "control_unsupported",
        value: "text",
      }),
    /does not support/u,
  );
});

test("one action binds one retained before snapshot to its receipt", async () => {
  const { cdp, evidence, gateway } = gatewayWith();

  const receipt = await gateway.callTool("set_control", {
    control_id: "control_query",
    value: "atlas",
  });

  assert.equal(
    cdp.calls.filter(({ method }) => method === "DOM.getDocument").length,
    2,
  );
  assert.deepEqual(
    evidence.artifacts.map(({ kind }) => kind),
    ["semantic-snapshot", "semantic-snapshot", "action-receipt"],
  );
  assert.equal(
    receipt.result.before_snapshot_sha256,
    evidence.artifacts[0].artifact.sha256,
  );
  assert.equal(
    receipt.result.after_snapshot_sha256,
    evidence.artifacts[1].artifact.sha256,
  );
});

test("select snapshots advertise the exact accepted option values", async () => {
  const selectControl = control({
    id: "control_status",
    role: "combobox",
    tag: "select",
    type: "select",
  });
  const { cdp, gateway } = gatewayWith({ controls: [selectControl] });
  const optionValues = new Map([
    [100, "all"],
    [101, "active"],
  ]);
  const send = cdp.send.bind(cdp);
  cdp.send = async (method, params, sessionId) => {
    if (
      method === "DOM.querySelectorAll" &&
      params.selector === "option"
    ) {
      return { nodeIds: [...optionValues.keys()] };
    }
    if (
      method === "DOM.describeNode" &&
      optionValues.has(params.nodeId)
    ) {
      return {
        node: {
          attributes: ["value", optionValues.get(params.nodeId)],
        },
      };
    }
    return send(method, params, sessionId);
  };

  const snapshot = await gateway.observePage();
  assert.deepEqual(snapshot.controls[0].options, ["all", "active"]);
  await gateway.callTool("set_control", {
    control_id: "control_status",
    value: "active",
  });
  await assert.rejects(
    () =>
      gateway.callTool("set_control", {
        control_id: "control_status",
        value: "Active",
      }),
    /not a declared select option/u,
  );
});

test("action hit testing rejects an occluding node", async () => {
  const { cdp, gateway } = gatewayWith();
  const send = cdp.send.bind(cdp);
  cdp.send = async (method, params, sessionId) => {
    if (method === "DOM.getNodeForLocation") {
      return { backendNodeId: 9999, nodeId: 9999 };
    }
    return send(method, params, sessionId);
  };

  await assert.rejects(
    () =>
      gateway.callTool("set_control", {
        control_id: "control_query",
        value: "atlas",
      }),
    /occluded/u,
  );
  assert.equal(
    cdp.calls.some(({ method }) => method === "Input.insertText"),
    false,
  );
});

test("control and select candidate inventories are bounded", async () => {
  const excessiveControls = gatewayWith();
  const controlSend = excessiveControls.cdp.send.bind(excessiveControls.cdp);
  excessiveControls.cdp.send = async (method, params, sessionId) => {
    if (
      method === "DOM.querySelectorAll" &&
      params.selector === "[data-control-id]"
    ) {
      return {
        nodeIds: Array.from({ length: 257 }, (_, index) => index + 20),
      };
    }
    return controlSend(method, params, sessionId);
  };
  await assert.rejects(
    () => excessiveControls.gateway.observePage(),
    /control candidates/u,
  );

  const selectControl = control({
    id: "control_status",
    role: "combobox",
    tag: "select",
    type: "select",
  });
  const excessiveOptions = gatewayWith({ controls: [selectControl] });
  const optionSend = excessiveOptions.cdp.send.bind(excessiveOptions.cdp);
  excessiveOptions.cdp.send = async (method, params, sessionId) => {
    if (
      method === "DOM.querySelectorAll" &&
      params.selector === "option"
    ) {
      return {
        nodeIds: Array.from({ length: 257 }, (_, index) => index + 100),
      };
    }
    return optionSend(method, params, sessionId);
  };
  await assert.rejects(
    () =>
      excessiveOptions.gateway.callTool("set_control", {
        control_id: "control_status",
        value: "active",
      }),
    /select options/u,
  );
});

test("evidence store reserves terminal journal capacity", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "qa-suite-gateway-test-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const testPolicy = policy({
    limits: {
      ...policy().limits,
      max_journal_entries: 10,
    },
  });
  const evidence = new EvidenceStore({
    policy: testPolicy,
    root,
    sourceSha256: DIGEST,
    toolsSha256: DIGEST,
  });
  await evidence.initialize();
  for (let index = 0; index < 8; index += 1) {
    await evidence.record("test_record", { index });
  }

  assert.throws(() => evidence.beginToolCall(), /closure record/u);
  const closed = await evidence.close({
    browser: {
      identity: browserIdentity(),
      pending_cdp_requests: 0,
    },
    status: "closed",
    violations: [],
  });

  assert.equal(closed.journal.entries, 10);
  assert.equal(validateBrowserGatewayClosure(closed), closed);
  const entries = (await readFile(
    join(root, "gateway-journal.jsonl"),
    "utf8",
  )).trim().split("\n").map((line) => JSON.parse(line));
  const journalSource = await readFile(
    join(root, "gateway-journal.jsonl"),
    "utf8",
  );
  assert.equal(Buffer.byteLength(journalSource), closed.journal.bytes);
  assert.equal(
    (await stat(join(root, "gateway-journal.jsonl"))).mode & 0o777,
    0o400,
  );
  await assert.rejects(
    () => readFile(join(root, "gateway-close.pending.json")),
    { code: "ENOENT" },
  );
  let previous = "0".repeat(64);
  for (let index = 0; index < entries.length; index += 1) {
    const { entry_sha256: digest, ...unsigned } = entries[index];
    assert.equal(unsigned.sequence, index + 1);
    assert.equal(unsigned.previous_sha256, previous);
    assert.equal(digest, sha256(canonicalJson(unsigned)));
    previous = digest;
  }
  assert.equal(previous, closed.journal.last_sha256);
});

test("journal byte saturation still publishes an invalid terminal closure", async (
  context,
) => {
  const root = await mkdtemp(join(tmpdir(), "qa-suite-gateway-test-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const evidence = new EvidenceStore({
    policy: policy({
      limits: {
        ...policy().limits,
        max_journal_bytes: 128 * 1024,
      },
    }),
    root,
    sourceSha256: DIGEST,
    toolsSha256: DIGEST,
  });
  await evidence.initialize();

  await assert.rejects(
    () => evidence.record("oversized", { text: "x".repeat(70 * 1024) }),
    /byte limit/u,
  );
  const closed = await evidence.close({
    browser: {
      identity: browserIdentity(),
      pending_cdp_requests: 0,
    },
    status: "closed",
    violations: [],
  });

  assert.equal(closed.status, "invalid");
  assert.deepEqual(closed.violations, [{
    detail: "journal capacity was exceeded",
    kind: "journal-limit",
  }]);
  assert.equal(validateBrowserGatewayClosure(closed), closed);
});

test("evidence store enforces aggregate artifacts and tool calls", async (
  context,
) => {
  const root = await mkdtemp(join(tmpdir(), "qa-suite-gateway-test-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const testPolicy = policy({
    limits: {
      ...policy().limits,
      max_artifact_bytes: 5,
      max_tool_calls: 1,
    },
  });
  const evidence = new EvidenceStore({
    policy: testPolicy,
    root,
    sourceSha256: DIGEST,
    toolsSha256: DIGEST,
  });
  await evidence.initialize();

  evidence.beginToolCall();
  assert.throws(() => evidence.beginToolCall(), /tool-call limit/u);
  await evidence.artifact("first", "bin", Buffer.from("abc"), 4);
  await assert.rejects(
    () => evidence.artifact("second", "bin", Buffer.from("def"), 4),
    /aggregate byte limit/u,
  );
});

test("closure validation cannot promote gateway evidence", () => {
  const value = closure();
  assert.equal(validateBrowserGatewayClosure(value), value);
  const invalid = closure({
    status: "invalid",
    violations: [{ detail: "request blocked", kind: "blocked-request" }],
  });
  assert.equal(validateBrowserGatewayClosure(invalid), invalid);

  for (const promoted of [
    { ...value, verification_status: "verified" },
    { ...value, qualification: "evidence" },
    { ...value, result: {} },
    { ...value, status: "invalid" },
    { ...value, browser: { ...value.browser, extra: true } },
    {
      ...value,
      journal: {
        ...value.journal,
        path: "QA/evidence/../gateway-journal.jsonl",
      },
    },
    {
      ...value,
      status: "invalid",
      violations: [{ detail: "bad", kind: "../escape" }],
    },
  ]) {
    assert.throws(() => validateBrowserGatewayClosure(promoted));
  }
});
