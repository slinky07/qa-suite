import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  readFile,
  realpath,
} from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  validateBrowserGatewayClosure,
} from "../scripts/evaluation/browser-gateway.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const RUN_LIVE = process.env.QA_SUITE_LIVE_BROWSER === "1";
const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = await realpath(
  join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const GATEWAY_PATH = join(ROOT, "scripts/evaluation/browser-gateway.mjs");
const FIXTURE_ROOT = join(
  ROOT,
  "tests/evaluation/fixtures/fx_cc4b61fbde593f6e101984583e5e9f88/public",
);
const FIXED_ENVIRONMENT = {
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
};

async function startFixtureServer() {
  const child = spawn(
    process.execPath,
    [join(FIXTURE_ROOT, "server.mjs"), "0"],
    {
      cwd: FIXTURE_ROOT,
      env: FIXED_ENVIRONMENT,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("fixture server startup timed out")),
      5000,
    );
    const inspect = () => {
      const line = stdout.split("\n")[0];
      if (!/^[0-9]+$/u.test(line)) return;
      clearTimeout(timeout);
      resolve(Number(line));
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`fixture server exited ${code}: ${stderr}`));
    });
  });
  return {
    child,
    port,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1000);
        child.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function listenOnLoopback(server) {
  server.listen(0, "127.0.0.1");
  await onceWithTimeout(server, "listening", 5000);
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return address.port;
}

function trackedServer(handler) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return {
    server,
    async stop() {
      if (!server.listening) return;
      const closed = onceWithTimeout(server, "close", 5000);
      server.close();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}

async function startWebSocketProbe() {
  let pagePort;
  let pageUpgrades = 0;
  let sinkConnections = 0;
  let sinkUpgrades = 0;
  const sink = trackedServer((_, response) => {
    response.writeHead(426, { "Content-Length": "0" });
    response.end();
  });
  sink.server.on("connection", () => {
    sinkConnections += 1;
  });
  sink.server.on("upgrade", (_, socket) => {
    sinkUpgrades += 1;
    socket.destroy();
  });
  const sinkPort = await listenOnLoopback(sink.server);
  const page = trackedServer((request, response) => {
    if (request.url !== "/") {
      response.writeHead(404, { "Content-Length": "0" });
      response.end();
      return;
    }
    const body = [
      "<!doctype html><meta charset=utf-8>",
      "<title>WebSocket confinement probe</title>",
      '<main data-surface-id="surface_socket_probe">',
      '<button data-control-id="control_open_socket" type="button">',
      "Open socket</button></main>",
      "<script>",
      "document.querySelector('button').addEventListener('click', () => {",
      `new WebSocket("ws://127.0.0.1:${pagePort}/socket");`,
      `new WebSocket("ws://127.0.0.1:${sinkPort}/socket");`,
      "});",
      "</script>",
    ].join("");
    response.writeHead(200, {
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(body);
  });
  page.server.on("upgrade", (_, socket) => {
    pageUpgrades += 1;
    socket.destroy();
  });
  pagePort = await listenOnLoopback(page.server);
  return {
    pagePort,
    pageUpgrades: () => pageUpgrades,
    sinkConnections: () => sinkConnections,
    sinkUpgrades: () => sinkUpgrades,
    async stop() {
      await Promise.all([page.stop(), sink.stop()]);
    },
  };
}

async function livePolicy({ allowedPaths, evidencePath, targetUrl }) {
  return {
    allowed_paths: allowedPaths,
    chrome: {
      path: CHROME_PATH,
      sha256: sha256(await readFile(CHROME_PATH)),
    },
    evidence_path: evidencePath,
    lane_root: ROOT,
    limits: {
      cdp_timeout_ms: 10_000,
      max_artifact_bytes: 32 * 1024 * 1024,
      max_journal_bytes: 2 * 1024 * 1024,
      max_journal_entries: 256,
      max_screenshot_bytes: 2 * 1024 * 1024,
      max_snapshot_bytes: 256 * 1024,
      max_tool_calls: 64,
    },
    phase: "task_execution",
    request_sha256: "b".repeat(64),
    schema_version: 1,
    target_url: targetUrl,
    viewport: {
      device_scale_factor: 1,
      height: 900,
      width: 1280,
    },
  };
}

function createMcpClient(child) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  child.once("error", rejectPending);
  child.once("exit", (code, signal) => {
    rejectPending(
      new Error(`browser gateway exited code=${code} signal=${signal}`),
    );
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiting = pending.get(message.id);
        if (waiting) {
          pending.delete(message.id);
          clearTimeout(waiting.timeout);
          if (message.error) {
            waiting.reject(new Error(message.error.message));
          } else {
            waiting.resolve(message.result);
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  return {
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      })}\n`);
    },
    request(method, params = {}) {
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify({
        id,
        jsonrpc: "2.0",
        method,
        params,
      })}\n`);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }, 20_000);
        pending.set(id, { reject, resolve, timeout });
      });
    },
  };
}

function startLiveGateway(policy) {
  const gateway = spawn(process.execPath, [GATEWAY_PATH], {
    cwd: ROOT,
    env: {
      ...FIXED_ENVIRONMENT,
      QA_SUITE_BROWSER_POLICY: canonicalJson(policy),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  gateway.stderr.setEncoding("utf8");
  gateway.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = createMcpClient(gateway);
  const closeGateway = async () => {
    gateway.stdin.end();
    const [code] = await onceWithTimeout(gateway, "close", 10_000);
    const evidenceRoot = join(ROOT, policy.evidence_path);
    const closure = JSON.parse(
      await readFile(join(evidenceRoot, "gateway-close.json"), "utf8"),
    );
    return { closure, code, evidenceRoot };
  };
  return {
    client,
    close: closeGateway,
    async closeLikeCodexTransport() {
      gateway.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        if (gateway.exitCode === null) gateway.kill("SIGKILL");
      }, 2000);
      try {
        return await closeGateway();
      } finally {
        clearTimeout(forceKill);
      }
    },
    errorContext() {
      return stderr;
    },
    gatewayPid: gateway.pid,
    initialize() {
      return client.request("initialize", {
        capabilities: {},
        clientInfo: { name: "gateway-live-test", version: "1" },
        protocolVersion: "2025-06-18",
      });
    },
    kill() {
      if (gateway.exitCode === null) gateway.kill("SIGKILL");
    },
    notifyInitialized() {
      client.notify("notifications/initialized");
    },
  };
}

async function processTable() {
  const child = spawn("/bin/ps", ["-axo", "pid=,ppid=,pgid="], {
    env: FIXED_ENVIRONMENT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await onceWithTimeout(child, "close", 5000);
  assert.equal(code, 0, stderr);
  return stdout.trim().split("\n").map((line) => {
    const [pid, parentPid, processGroupId] = line.trim().split(/\s+/u);
    return {
      parentPid: Number(parentPid),
      pid: Number(pid),
      processGroupId: Number(processGroupId),
    };
  });
}

async function waitForBrowserSupervisor(gatewayPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const children = (await processTable()).filter(
      ({ parentPid, pid, processGroupId }) =>
        parentPid === gatewayPid && pid === processGroupId,
    );
    if (children.length === 1) return children[0].processGroupId;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("browser supervisor process group was not observed");
}

async function waitForEmptyProcessGroup(processGroupId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroupId, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      if (error?.code !== "EPERM") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function toolResult(response) {
  const text = response.content.find(({ type }) => type === "text");
  assert.ok(text);
  if (response.isError) {
    throw new Error(`browser tool failed: ${text.text}`);
  }
  return JSON.parse(text.text);
}

test("live gateway inventories and exercises Project Finder controls", {
  skip: !RUN_LIVE,
  timeout: 30_000,
}, async () => {
  const fixture = await startFixtureServer();
  const evidenceToken = randomBytes(8).toString("hex");
  const evidencePath = `QA/evidence/live_${evidenceToken}/task_execution`;
  const policy = await livePolicy({
    allowedPaths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    evidencePath,
    targetUrl: `http://127.0.0.1:${fixture.port}/`,
  });
  const session = startLiveGateway(policy);
  const { client } = session;

  try {
    await session.initialize();
    session.notifyInitialized();
    const tools = await client.request("tools/list");
    assert.deepEqual(
      tools.tools.map(({ name }) => name),
      [
        "observe_page",
        "capture_screenshot",
        "set_control",
        "activate_control",
      ],
    );

    const initial = toolResult(
      await client.request("tools/call", {
        arguments: {},
        name: "observe_page",
      }),
    );
    assert.equal(initial.title, "Project Finder");
    assert.deepEqual(
      initial.surfaces.map(({ id }) => id),
      ["surface_filter_workspace"],
    );
    assert.deepEqual(
      initial.controls.map(({ id }) => id),
      [
        "control_project_query",
        "control_project_status",
        "control_apply_filters",
        "control_search_help",
      ],
    );
    toolResult(
      await client.request("tools/call", {
        arguments: { control_id: "control_search_help" },
        name: "activate_control",
      }),
    );
    const revealed = toolResult(
      await client.request("tools/call", {
        arguments: {},
        name: "observe_page",
      }),
    );
    assert.deepEqual(
      revealed.controls.map(({ id }) => id),
      [
        "control_project_query",
        "control_project_status",
        "control_apply_filters",
        "control_search_help",
        "control_edit_filters",
      ],
    );

    toolResult(
      await client.request("tools/call", {
        arguments: {
          control_id: "control_project_query",
          value: "atlas",
        },
        name: "set_control",
      }),
    );
    toolResult(
      await client.request("tools/call", {
        arguments: {
          control_id: "control_project_status",
          value: "active",
        },
        name: "set_control",
      }),
    );
    toolResult(
      await client.request("tools/call", {
        arguments: { control_id: "control_apply_filters" },
        name: "activate_control",
      }),
    );
    const filtered = toolResult(
      await client.request("tools/call", {
        arguments: {},
        name: "observe_page",
      }),
    );
    assert.ok(
      filtered.visible_text.some((text) => text.includes("Atlas Mobile")),
    );
    const screenshot = await client.request("tools/call", {
      arguments: {},
      name: "capture_screenshot",
    });
    const screenshotResult = toolResult(screenshot);
    assert.equal(screenshotResult.mime_type, "image/png");
    assert.ok(screenshot.content.some(({ type }) => type === "image"));

    const { closure, code } = await session.close();
    assert.equal(code, 0, session.errorContext());
    assert.equal(validateBrowserGatewayClosure(closure), closure);
    assert.equal(closure.status, "closed");
  } catch (error) {
    throw new Error(`${error.message}\n${session.errorContext()}`);
  } finally {
    session.kill();
    await fixture.stop();
  }
});

test("live gateway denies WebSocket egress before the sink", {
  skip: !RUN_LIVE,
  timeout: 30_000,
}, async () => {
  const fixture = await startWebSocketProbe();
  const evidenceToken = randomBytes(8).toString("hex");
  const evidencePath = `QA/evidence/live_${evidenceToken}/task_execution`;
  const policy = await livePolicy({
    allowedPaths: ["/"],
    evidencePath,
    targetUrl: `http://127.0.0.1:${fixture.pagePort}/`,
  });
  const session = startLiveGateway(policy);
  const { client } = session;

  try {
    await session.initialize();
    session.notifyInitialized();
    const action = await client.request("tools/call", {
      arguments: { control_id: "control_open_socket" },
      name: "activate_control",
    });
    assert.equal(action.isError, true);
    assert.match(action.content[0].text, /websocket/u);

    const { closure, code, evidenceRoot } = await session.close();
    assert.equal(code, 1);
    assert.equal(fixture.pageUpgrades(), 0);
    assert.equal(fixture.sinkConnections(), 0);
    assert.equal(fixture.sinkUpgrades(), 0);
    assert.equal(validateBrowserGatewayClosure(closure), closure);
    assert.equal(closure.status, "invalid");
    assert.ok(
      closure.violations.some(({ kind }) => kind === "websocket"),
    );
    const journal = (await readFile(
      join(evidenceRoot, "gateway-journal.jsonl"),
      "utf8",
    )).trim().split("\n").map((line) => JSON.parse(line));
    const proxySummary = journal.find(
      ({ event }) => event === "browser_proxy_summary",
    );
    assert.ok(proxySummary);
    assert.ok(proxySummary.payload.denied.connect >= 2);
  } catch (error) {
    throw new Error(`${error.message}\n${session.errorContext()}`);
  } finally {
    session.kill();
    await fixture.stop();
  }
});

test("live gateway loss force-empties its supervised Chrome group", {
  skip: !RUN_LIVE,
  timeout: 30_000,
}, async () => {
  const fixture = await startFixtureServer();
  const evidenceToken = randomBytes(8).toString("hex");
  const policy = await livePolicy({
    allowedPaths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    evidencePath:
      `QA/evidence/live_${evidenceToken}/task_execution`,
    targetUrl: `http://127.0.0.1:${fixture.port}/`,
  });
  const session = startLiveGateway(policy);
  let processGroupId;

  try {
    await session.initialize();
    session.notifyInitialized();
    await session.client.request("tools/list");
    processGroupId = await waitForBrowserSupervisor(session.gatewayPid);

    session.kill();

    assert.equal(
      await waitForEmptyProcessGroup(processGroupId),
      true,
      "Chrome process group survived gateway loss",
    );
  } catch (error) {
    throw new Error(`${error.message}\n${session.errorContext()}`);
  } finally {
    session.kill();
    if (
      processGroupId !== undefined &&
      !(await waitForEmptyProcessGroup(processGroupId))
    ) {
      process.kill(-processGroupId, "SIGKILL");
    }
    await fixture.stop();
  }
});

test("live gateway survives Codex termination until transport EOF", {
  skip: !RUN_LIVE,
  timeout: 30_000,
}, async () => {
  const fixture = await startFixtureServer();
  const evidenceToken = randomBytes(8).toString("hex");
  const policy = await livePolicy({
    allowedPaths: ["/", "/app.mjs", "/index.html", "/styles.css"],
    evidencePath:
      `QA/evidence/live_${evidenceToken}/task_execution`,
    targetUrl: `http://127.0.0.1:${fixture.port}/`,
  });
  const session = startLiveGateway(policy);
  let processGroupId;

  try {
    await session.initialize();
    session.notifyInitialized();
    await session.client.request("tools/list");
    processGroupId = await waitForBrowserSupervisor(session.gatewayPid);

    const { closure, code, evidenceRoot } =
      await session.closeLikeCodexTransport();

    assert.equal(code, 0, session.errorContext());
    assert.equal(validateBrowserGatewayClosure(closure), closure);
    assert.equal(closure.status, "closed");
    assert.equal(
      await waitForEmptyProcessGroup(processGroupId),
      true,
      "Chrome process group survived Codex transport closure",
    );
    const journal = (await readFile(
      join(evidenceRoot, "gateway-journal.jsonl"),
      "utf8",
    )).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(journal.at(-1).event, "gateway_closed");
  } catch (error) {
    throw new Error(`${error.message}\n${session.errorContext()}`);
  } finally {
    session.kill();
    if (
      processGroupId !== undefined &&
      !(await waitForEmptyProcessGroup(processGroupId))
    ) {
      process.kill(-processGroupId, "SIGKILL");
    }
    await fixture.stop();
  }
});

async function onceWithTimeout(emitter, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      emitter.removeListener(event, onEvent);
      if (event !== "error") emitter.removeListener("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${event} timed out`));
    }, timeoutMs);
    emitter.once(event, onEvent);
    if (event !== "error") emitter.once("error", onError);
  });
}
