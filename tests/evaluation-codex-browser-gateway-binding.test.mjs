import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  EvidenceStore,
  bindCodexBrowserGatewayJournal,
  browserToolsForPhase,
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

function bindingReference(text) {
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256(Buffer.from(text, "utf8")),
    text,
  };
}

function gatewayMcpResult(output, image) {
  const content = [{
    text: canonicalJson(output),
    type: "text",
  }];
  if (image !== undefined) {
    content.push({
      data: image.toString("base64"),
      mimeType: "image/png",
      type: "image",
    });
  }
  return {
    content,
    structured_content: null,
  };
}

function serializeCodexCalls(calls, server = "browser_gateway") {
  const events = [
    {
      thread_id: "01900000-0000-7000-8000-000000000145",
      type: "thread.started",
    },
    { type: "turn.started" },
  ];
  calls.forEach((call, index) => {
    const identity = {
      arguments: structuredClone(call.arguments),
      error: null,
      id: `item_${index}`,
      result: null,
      server,
      status: "in_progress",
      tool: call.tool,
      type: "mcp_tool_call",
    };
    events.push({
      item: structuredClone(identity),
      type: "item.started",
    });
    events.push({
      item: {
        ...structuredClone(identity),
        result: structuredClone(call.mcpResult),
        status: "completed",
      },
      type: "item.completed",
    });
  });
  events.push({
    item: {
      id: `item_${calls.length}`,
      text: "{\"status\":\"ok\"}",
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

async function gatewayBindingFixture() {
  const selectedPolicy = validateBrowserGatewayPolicy(policy());
  const gatewaySourceSha256 = "c".repeat(64);
  const toolsSha256 = sha256(
    canonicalJson(browserToolsForPhase(selectedPolicy.phase)),
  );
  const root = await mkdtemp(join(tmpdir(), "qa-suite-gateway-binding-"));
  try {
    const evidence = new EvidenceStore({
      policy: selectedPolicy,
      root,
      sourceSha256: gatewaySourceSha256,
      toolsSha256,
    });
    await evidence.initialize();
    const method = bindingReference("GET");
    const url = bindingReference(selectedPolicy.target_url);
    await evidence.record("page_request", {
      decision: "continued",
      method: method.text,
      method_bytes: method.bytes,
      method_sha256: method.sha256,
      url: url.text,
      url_bytes: url.bytes,
      url_sha256: url.sha256,
    });
    const identity = browserIdentity();
    const startedIdentity = { ...identity };
    delete startedIdentity.stderr_bytes;
    delete startedIdentity.stderr_sha256;
    await evidence.record("browser_started", {
      browser: startedIdentity,
      target_url: selectedPolicy.target_url,
    });

    const snapshotBytes = Buffer.from("{}");
    const observeOutput = {
      artifact: {
        bytes: snapshotBytes.length,
        path:
          `${selectedPolicy.evidence_path}/0001-semantic-snapshot.json`,
        sha256: sha256(snapshotBytes),
      },
      schema_version: 1,
      url: selectedPolicy.target_url,
    };
    const image = Buffer.from("gateway-png");
    const screenshotOutput = {
      artifact: {
        bytes: image.length,
        path: `${selectedPolicy.evidence_path}/0002-viewport.png`,
        sha256: sha256(image),
      },
      height: selectedPolicy.viewport.height,
      mime_type: "image/png",
      schema_version: 1,
      width: selectedPolicy.viewport.width,
    };
    const calls = [
      {
        arguments: {},
        mcpResult: gatewayMcpResult(observeOutput),
        output: observeOutput,
        tool: "observe_page",
      },
      {
        arguments: {},
        mcpResult: gatewayMcpResult(screenshotOutput, image),
        output: screenshotOutput,
        tool: "capture_screenshot",
      },
    ];
    for (const call of calls) {
      await evidence.record("tool_completed", {
        request_sha256: sha256(canonicalJson({
          arguments: call.arguments,
          name: call.tool,
        })),
        result_sha256: sha256(canonicalJson(call.output)),
        tool: call.tool,
      });
    }
    await evidence.record("browser_proxy_summary", {
      denied: {
        connect: 0,
        http: 0,
        malformed: 0,
        overflow: 0,
        upgrade: 0,
      },
      last_sha256: sha256(canonicalJson({ schema_version: 1 })),
      observed_events: 0,
      schema_version: 1,
    });
    const closed = await evidence.close({
      browser: {
        identity,
        pending_cdp_requests: 0,
      },
      status: "closed",
      violations: [],
    });
    const journalSource = await readFile(
      join(root, "gateway-journal.jsonl"),
      "utf8",
    );
    return {
      calls,
      input: {
        closureSource: canonicalJson(closed),
        codexSource: serializeCodexCalls(calls),
        expectedGatewaySourceSha256: gatewaySourceSha256,
        expectedMcpServer: "browser_gateway",
        journalSource,
        policySource: canonicalJson(selectedPolicy),
      },
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function parsedJournal(source) {
  return source.slice(0, -1).split("\n").map((line) => JSON.parse(line));
}

function chainedJournal(entries) {
  let previous = "0".repeat(64);
  return entries.map((entry, index) => {
    const { entry_sha256: _discarded, ...fields } = entry;
    const unsigned = {
      ...fields,
      previous_sha256: previous,
      sequence: index + 1,
    };
    const rebound = {
      ...unsigned,
      entry_sha256: sha256(canonicalJson(unsigned)),
    };
    previous = rebound.entry_sha256;
    return rebound;
  });
}

function serializeJournalEntries(entries) {
  return entries
    .map((entry) =>
      `${JSON.stringify(JSON.parse(canonicalJson(entry)))}\n`
    )
    .join("");
}

function replaceJournal(fixture, entries) {
  const rebound = chainedJournal(entries);
  const source = serializeJournalEntries(rebound);
  const closed = JSON.parse(fixture.input.closureSource);
  closed.journal.bytes = Buffer.byteLength(source, "utf8");
  closed.journal.entries = rebound.length;
  closed.journal.last_sha256 = rebound.at(-1).entry_sha256;
  fixture.input.closureSource = canonicalJson(closed);
  fixture.input.journalSource = source;
}

function mutateCodex(fixture, mutator) {
  const events = fixture.input.codexSource
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line));
  mutator(events);
  fixture.input.codexSource = `${events.map(JSON.stringify).join("\n")}\n`;
}

test("binds every Codex call to one ordered gateway journal receipt", async () => {
  const fixture = await gatewayBindingFixture();
  const bound = bindCodexBrowserGatewayJournal(fixture.input);

  assert.equal(bound.schema_version, 1);
  assert.equal(bound.verification_status, "unverified");
  assert.equal(bound.qualification, "not-evidence");
  assert.equal(bound.result, null);
  assert.equal(bound.binding.phase, "interface_inventory");
  assert.equal(bound.binding.calls.length, 2);
  assert.deepEqual(
    bound.binding.calls.map((call) => ({
      codex_completed_sequence: call.codex_completed_sequence,
      codex_started_sequence: call.codex_started_sequence,
      gateway_journal_sequence: call.gateway_journal_sequence,
      tool: call.tool,
    })),
    [
      {
        codex_completed_sequence: 4,
        codex_started_sequence: 3,
        gateway_journal_sequence: 4,
        tool: "observe_page",
      },
      {
        codex_completed_sequence: 6,
        codex_started_sequence: 5,
        gateway_journal_sequence: 5,
        tool: "capture_screenshot",
      },
    ],
  );
  assert.equal(
    bound.binding_sha256,
    sha256(canonicalJson(bound.binding)),
  );
});

test("binding consumes every ordered call and journal receipt exactly once", async () => {
  const fixture = await gatewayBindingFixture();
  const mutations = [
    {
      error: /exhaust the gateway journal/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        entries.splice(entries.findIndex(({ event }) =>
          event === "tool_completed"
        ), 1);
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /exhaust the gateway journal/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        const completed = entries.find(({ event }) =>
          event === "tool_completed"
        );
        entries.splice(-2, 0, structuredClone(completed));
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /do not match the gateway journal/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        const indexes = entries
          .map(({ event }, index) => event === "tool_completed" ? index : -1)
          .filter((index) => index >= 0);
        [entries[indexes[0]], entries[indexes[1]]] = [
          entries[indexes[1]],
          entries[indexes[0]],
        ];
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /do not match the gateway journal/u,
      mutate(candidate) {
        candidate.input.codexSource = serializeCodexCalls([
          candidate.calls[1],
          candidate.calls[0],
        ]);
      },
    },
    {
      error: /exhaust the gateway journal/u,
      mutate(candidate) {
        candidate.input.codexSource = serializeCodexCalls([
          ...candidate.calls,
          candidate.calls[0],
        ]);
      },
    },
  ];

  for (const row of mutations) {
    const candidate = structuredClone(fixture);
    row.mutate(candidate);
    assert.throws(
      () => bindCodexBrowserGatewayJournal(candidate.input),
      row.error,
    );
  }
});

test("binding rejects invocation and MCP-result substitution", async () => {
  const fixture = await gatewayBindingFixture();
  const mutations = [
    {
      error: /unexpected server/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          for (const event of events) {
            if (event.item?.type === "mcp_tool_call") {
              event.item.server = "other_gateway";
            }
          }
        });
      },
    },
    {
      error: /observe_page arguments/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          for (const event of events) {
            if (event.item?.tool === "observe_page") {
              event.item.arguments = { unexpected: true };
            }
          }
        });
      },
    },
    {
      error: /must use canonical JSON/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          const completed = events.find((event) =>
            event.type === "item.completed" &&
            event.item?.tool === "observe_page"
          );
          completed.item.result.content[0].text = "{\"z\":1, \"a\":2}";
        });
      },
    },
    {
      error: /gateway result fields/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          const completed = events.find((event) =>
            event.type === "item.completed" &&
            event.item?.tool === "observe_page"
          );
          completed.item.result._meta = {};
        });
      },
    },
    {
      error: /structured_content must be null/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          const completed = events.find((event) =>
            event.type === "item.completed" &&
            event.item?.tool === "observe_page"
          );
          completed.item.result.structured_content = {};
        });
      },
    },
    {
      error: /image does not match its result/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          const completed = events.find((event) =>
            event.type === "item.completed" &&
            event.item?.tool === "capture_screenshot"
          );
          completed.item.result.content[1].data =
            Buffer.from("other-png").toString("base64");
        });
      },
    },
    {
      error: /do not match the gateway journal/u,
      mutate(candidate) {
        mutateCodex(candidate, (events) => {
          const completed = events.find((event) =>
            event.type === "item.completed" &&
            event.item?.tool === "observe_page"
          );
          completed.item.result.content[0].text =
            canonicalJson({ substituted: true });
        });
      },
    },
  ];

  for (const row of mutations) {
    const candidate = structuredClone(fixture);
    row.mutate(candidate);
    assert.throws(
      () => bindCodexBrowserGatewayJournal(candidate.input),
      row.error,
    );
  }
});

test("binding rejects raw and coherently rehashed journal drift", async () => {
  const fixture = await gatewayBindingFixture();

  const raw = structuredClone(fixture);
  const rawEntries = parsedJournal(raw.input.journalSource);
  rawEntries.find(({ event }) =>
    event === "tool_completed"
  ).payload.result_sha256 = "f".repeat(64);
  raw.input.journalSource = serializeJournalEntries(rawEntries);
  assert.throws(
    () => bindCodexBrowserGatewayJournal(raw.input),
    /hash chain is invalid/u,
  );

  const rebound = structuredClone(fixture);
  const reboundEntries = parsedJournal(rebound.input.journalSource);
  reboundEntries.find(({ event }) =>
    event === "tool_completed"
  ).payload.result_sha256 = "f".repeat(64);
  replaceJournal(rebound, reboundEntries);
  assert.throws(
    () => bindCodexBrowserGatewayJournal(rebound.input),
    /do not match the gateway journal/u,
  );
});

test("binding enforces coherent journal writer byte limits", async () => {
  const oversizedEntry = await gatewayBindingFixture();
  const oversizedEntries = parsedJournal(
    oversizedEntry.input.journalSource,
  );
  const pageRequest = oversizedEntries.find(({ event }) =>
    event === "page_request"
  );
  pageRequest.payload = { opaque: "x".repeat(70_000) };
  replaceJournal(oversizedEntry, oversizedEntries);
  assert.throws(
    () => bindCodexBrowserGatewayJournal(oversizedEntry.input),
    /journal entry exceeds its byte limit/u,
  );

  const exhaustedReserve = await gatewayBindingFixture();
  const selectedPolicy = JSON.parse(exhaustedReserve.input.policySource);
  selectedPolicy.limits.max_journal_bytes = 128 * 1024;
  exhaustedReserve.input.policySource = canonicalJson(selectedPolicy);
  const closed = JSON.parse(exhaustedReserve.input.closureSource);
  closed.policy_sha256 = sha256(canonicalJson(selectedPolicy));
  exhaustedReserve.input.closureSource = canonicalJson(closed);
  const reserveEntries = parsedJournal(
    exhaustedReserve.input.journalSource,
  );
  reserveEntries[0].payload.policy_sha256 = closed.policy_sha256;
  const proxyIndex = reserveEntries.findIndex(({ event }) =>
    event === "browser_proxy_summary"
  );
  const consoleEntry = structuredClone(
    reserveEntries.find(({ event }) => event === "page_request"),
  );
  consoleEntry.event = "browser_console";
  consoleEntry.payload = { opaque: "y".repeat(24_000) };
  reserveEntries.splice(
    proxyIndex,
    0,
    structuredClone(consoleEntry),
    structuredClone(consoleEntry),
    structuredClone(consoleEntry),
  );
  replaceJournal(exhaustedReserve, reserveEntries);
  assert.throws(
    () => bindCodexBrowserGatewayJournal(exhaustedReserve.input),
    /reserved nonterminal capacity/u,
  );
});

test("binding enforces the coherent gateway MCP response byte limit", async () => {
  const fixture = await gatewayBindingFixture();
  const boundaryResult = {
    opaque: "q".repeat(8_388_363),
  };
  mutateCodex(fixture, (events) => {
    const completed = events.find((event) =>
      event.type === "item.completed" &&
      event.item?.tool === "observe_page"
    );
    completed.item.result.content[0].text = canonicalJson(boundaryResult);
  });
  const entries = parsedJournal(fixture.input.journalSource);
  entries.find(({ event, payload }) =>
    event === "tool_completed" && payload.tool === "observe_page"
  ).payload.result_sha256 = sha256(canonicalJson(boundaryResult));
  replaceJournal(fixture, entries);

  assert.throws(
    () => bindCodexBrowserGatewayJournal(fixture.input),
    /gateway result exceeds its byte limit/u,
  );
});

test("binding requires the complete successful gateway lifecycle", async () => {
  const fixture = await gatewayBindingFixture();
  const mutations = [
    {
      error: /runtime order is invalid/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        entries.splice(entries.findIndex(({ event }) =>
          event === "browser_started"
        ), 1);
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /contains a failed tool call/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        const completed = entries.find(({ event }) =>
          event === "tool_completed"
        );
        completed.event = "tool_failed";
        completed.payload = {
          error: "failed",
          request_sha256: completed.payload.request_sha256,
          tool: completed.payload.tool,
        };
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /event unexpected_record is unsupported/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        const request = entries.find(({ event }) => event === "page_request");
        request.event = "unexpected_record";
        request.payload = {};
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /close does not match closure/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        entries.at(-1).payload.pending_cdp_requests = 1;
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /start record does not match closure/u,
      mutate(candidate) {
        const entries = parsedJournal(candidate.input.journalSource);
        const started = entries.find(({ event }) =>
          event === "browser_started"
        );
        started.payload.browser.product = "Chrome/substituted";
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /tool-call limit/u,
      mutate(candidate) {
        const selectedPolicy = JSON.parse(candidate.input.policySource);
        selectedPolicy.limits.max_tool_calls = 1;
        candidate.input.policySource = canonicalJson(selectedPolicy);
        const closed = JSON.parse(candidate.input.closureSource);
        closed.policy_sha256 = sha256(canonicalJson(selectedPolicy));
        candidate.input.closureSource = canonicalJson(closed);
        const entries = parsedJournal(candidate.input.journalSource);
        entries[0].payload.policy_sha256 = closed.policy_sha256;
        replaceJournal(candidate, entries);
      },
    },
    {
      error: /not bound to its authorities/u,
      mutate(candidate) {
        const substituted = "d".repeat(64);
        const closed = JSON.parse(candidate.input.closureSource);
        closed.source_sha256 = substituted;
        candidate.input.closureSource = canonicalJson(closed);
        const entries = parsedJournal(candidate.input.journalSource);
        entries[0].payload.source_sha256 = substituted;
        replaceJournal(candidate, entries);
      },
    },
  ];

  for (const row of mutations) {
    const candidate = structuredClone(fixture);
    row.mutate(candidate);
    assert.throws(
      () => bindCodexBrowserGatewayJournal(candidate.input),
      row.error,
    );
  }
});
