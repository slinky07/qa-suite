import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync } from "node:fs";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  parseContractJson,
  sha256,
} from "./contracts.mjs";
import { parseCodex0145TurnJsonl } from "./codex-0145-events.mjs";

const PHASES = new Set([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const CONTROL_ID = /^control_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FIXED_ENVIRONMENT = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_CLOSURE_BYTES = 64 * 1024;
const MAX_MCP_LINE_BYTES = 2 * 1024 * 1024;
const MAX_MCP_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_MCP_MESSAGES = 512;
const MAX_CDP_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_BROWSER_STDERR_BYTES = 256 * 1024;
const MAX_PROXY_AUDIT_EVENTS = 4096;
const MAX_JOURNAL_ENTRY_BYTES = 64 * 1024;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_VISIBLE_TEXT_ITEMS = 256;
const MAX_HEADINGS = 64;
const MAX_SURFACES = 64;
const MAX_CONTROLS = 128;
const MAX_CONTROL_CANDIDATES = 256;
const MAX_OPTIONS = 256;
const MAX_TEXT_BYTES = 64 * 1024;
const MCP_PROTOCOL_VERSION = "2025-06-18";
const VIOLATION_KIND = /^[a-z][a-z0-9-]{0,63}$/;
const SOURCE_PATH = fileURLToPath(import.meta.url);
const BROWSER_SUPERVISOR_MODE = "--browser-supervisor";
const BROWSER_SUPERVISOR_CONFIG = "QA_SUITE_BROWSER_SUPERVISOR";

const OBSERVATION_TOOLS = Object.freeze([
  {
    description:
      "Observe the current rendered page through a bounded semantic snapshot.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "observe_page",
  },
  {
    description:
      "Capture the current fixed viewport as retained PNG evidence.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "capture_screenshot",
  },
]);

const ACTION_TOOLS = Object.freeze([
  {
    description:
      "Set a visible text, select, or checkbox control by its inventoried ID.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        control_id: {
          maxLength: 128,
          pattern: CONTROL_ID.source,
          type: "string",
        },
        value: {
          oneOf: [
            { maxLength: 256, type: "string" },
            { type: "boolean" },
          ],
        },
      },
      required: ["control_id", "value"],
      type: "object",
    },
    name: "set_control",
  },
  {
    description:
      "Activate a visible button, summary, or other clickable control by ID.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        control_id: {
          maxLength: 128,
          pattern: CONTROL_ID.source,
          type: "string",
        },
      },
      required: ["control_id"],
      type: "object",
    },
    name: "activate_control",
  },
]);

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

function assertDenseArray(value, label, { maximum, minimum = 0 }) {
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
  return value;
}

function assertInteger(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${label} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function assertBoundedString(value, label, maximum, minimum = 0) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(
      `${label} must be a string containing ${minimum}-${maximum} characters`,
    );
  }
  return value;
}

function assertAbsolutePath(value, label) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function validatedEvidencePath(value) {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    throw new Error("policy.evidence_path must be a safe relative path");
  }
  const segments = value.split("/");
  if (
    segments.length < 3 ||
    segments[0] !== "QA" ||
    segments[1] !== "evidence" ||
    !segments.slice(2).every((segment) => SAFE_SEGMENT.test(segment))
  ) {
    throw new Error(
      "policy.evidence_path must be a safe child of QA/evidence",
    );
  }
  return value;
}

function validatedTargetUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("policy.target_url must be a bounded URL");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("policy.target_url must be a valid URL");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.href !== value
  ) {
    throw new Error(
      "policy.target_url must be an exact numeric-loopback HTTP URL",
    );
  }
  return url;
}

function validatedAllowedPaths(value, target) {
  const paths = assertDenseArray(value, "policy.allowed_paths", {
    maximum: 64,
    minimum: 1,
  });
  const observed = [];
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("?") ||
      path.includes("#") ||
      path.includes("\0") ||
      new URL(path, target.origin).pathname !== path
    ) {
      throw new Error(`policy.allowed_paths[${index}] is invalid`);
    }
    observed.push(path);
  }
  if (
    new Set(observed).size !== observed.length ||
    canonicalJson(observed) !== canonicalJson([...observed].sort()) ||
    !observed.includes(target.pathname)
  ) {
    throw new Error(
      "policy.allowed_paths must be sorted, unique, and include the target",
    );
  }
  return observed;
}

function validatedViewport(value) {
  assertExactKeys(
    value,
    ["device_scale_factor", "height", "width"],
    "policy.viewport",
  );
  return {
    device_scale_factor: assertInteger(
      value.device_scale_factor,
      "policy.viewport.device_scale_factor",
      1,
      2,
    ),
    height: assertInteger(value.height, "policy.viewport.height", 320, 2160),
    width: assertInteger(value.width, "policy.viewport.width", 320, 3840),
  };
}

function validatedLimits(value) {
  assertExactKeys(
    value,
    [
      "cdp_timeout_ms",
      "max_artifact_bytes",
      "max_journal_bytes",
      "max_journal_entries",
      "max_screenshot_bytes",
      "max_snapshot_bytes",
      "max_tool_calls",
    ],
    "policy.limits",
  );
  return {
    cdp_timeout_ms: assertInteger(
      value.cdp_timeout_ms,
      "policy.limits.cdp_timeout_ms",
      100,
      30_000,
    ),
    max_artifact_bytes: assertInteger(
      value.max_artifact_bytes,
      "policy.limits.max_artifact_bytes",
      1024 * 1024,
      128 * 1024 * 1024,
    ),
    max_journal_bytes: assertInteger(
      value.max_journal_bytes,
      "policy.limits.max_journal_bytes",
      2 * MAX_JOURNAL_ENTRY_BYTES,
      MAX_JOURNAL_BYTES,
    ),
    max_journal_entries: assertInteger(
      value.max_journal_entries,
      "policy.limits.max_journal_entries",
      10,
      4096,
    ),
    max_screenshot_bytes: assertInteger(
      value.max_screenshot_bytes,
      "policy.limits.max_screenshot_bytes",
      64 * 1024,
      4 * 1024 * 1024,
    ),
    max_snapshot_bytes: assertInteger(
      value.max_snapshot_bytes,
      "policy.limits.max_snapshot_bytes",
      16 * 1024,
      512 * 1024,
    ),
    max_tool_calls: assertInteger(
      value.max_tool_calls,
      "policy.limits.max_tool_calls",
      1,
      256,
    ),
  };
}

export function validateBrowserGatewayPolicy(value) {
  assertExactKeys(
    value,
    [
      "allowed_paths",
      "chrome",
      "evidence_path",
      "lane_root",
      "limits",
      "phase",
      "request_sha256",
      "schema_version",
      "target_url",
      "viewport",
    ],
    "browser gateway policy",
  );
  if (value.schema_version !== 1) {
    throw new Error("browser gateway policy.schema_version must be 1");
  }
  if (!PHASES.has(value.phase)) {
    throw new Error("browser gateway policy.phase is invalid");
  }
  const target = validatedTargetUrl(value.target_url);
  assertExactKeys(value.chrome, ["path", "sha256"], "policy.chrome");
  const policy = {
    allowed_paths: validatedAllowedPaths(value.allowed_paths, target),
    chrome: {
      path: assertAbsolutePath(value.chrome.path, "policy.chrome.path"),
      sha256: assertDigest(value.chrome.sha256, "policy.chrome.sha256"),
    },
    evidence_path: validatedEvidencePath(value.evidence_path),
    lane_root: assertAbsolutePath(value.lane_root, "policy.lane_root"),
    limits: validatedLimits(value.limits),
    phase: value.phase,
    request_sha256: assertDigest(
      value.request_sha256,
      "policy.request_sha256",
    ),
    schema_version: 1,
    target_url: target.href,
    viewport: validatedViewport(value.viewport),
  };
  return policy;
}

export function parseBrowserGatewayPolicy(source) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > MAX_POLICY_BYTES
  ) {
    throw new Error("browser gateway policy source is invalid");
  }
  const policy = parseContractJson(source, "browser gateway policy");
  if (source !== canonicalJson(policy)) {
    throw new Error("browser gateway policy must use canonical JSON");
  }
  return validateBrowserGatewayPolicy(policy);
}

export function browserToolsForPhase(phase) {
  if (!PHASES.has(phase)) {
    throw new Error("browser gateway phase is invalid");
  }
  return structuredClone(
    phase === "task_execution"
      ? [...OBSERVATION_TOOLS, ...ACTION_TOOLS]
      : OBSERVATION_TOOLS,
  );
}

function timeoutAfter(milliseconds, message) {
  let timeout;
  const promise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return {
    clear() {
      clearTimeout(timeout);
    },
    promise,
  };
}

function canonicalJsonLine(value) {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)))}\n`;
}

function journalLimitError(message) {
  const error = new Error(message);
  error.code = "QA_GATEWAY_JOURNAL_LIMIT";
  return error;
}

export class CdpPipeClient {
  constructor({
    input,
    maxFrameBytes = MAX_CDP_FRAME_BYTES,
    output,
    timeoutMs,
  }) {
    if (
      input === null ||
      typeof input?.on !== "function" ||
      output === null ||
      typeof output?.write !== "function"
    ) {
      throw new Error("CDP pipe streams are invalid");
    }
    this.input = input;
    this.maxFrameBytes = maxFrameBytes;
    this.output = output;
    this.timeoutMs = timeoutMs;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.input.on("data", (chunk) => this.#onData(chunk));
    this.input.once("end", () => this.#fail(new Error("CDP pipe ended")));
    this.input.once("error", (error) => this.#fail(error));
    this.output.once?.("error", (error) => this.#fail(error));
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? new Set();
    handlers.add(handler);
    this.handlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  async send(method, params = {}, sessionId) {
    if (this.closed) throw new Error("CDP pipe is closed");
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    const frame = Buffer.from(`${JSON.stringify(message)}\0`, "utf8");
    if (frame.length > this.maxFrameBytes) {
      throw new Error("CDP request exceeds its frame limit");
    }
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { method, reject, resolve, timeout });
    });
    this.output.write(frame);
    return result;
  }

  waitFor(method, predicate = () => true) {
    const deadline = timeoutAfter(
      this.timeoutMs,
      `CDP event timed out: ${method}`,
    );
    let remove;
    const event = new Promise((resolve, reject) => {
      remove = this.on(method, (params, sessionId) => {
        try {
          if (!predicate(params, sessionId)) return;
          remove();
          deadline.clear();
          resolve({ params, sessionId });
        } catch (error) {
          remove();
          deadline.clear();
          reject(error);
        }
      });
    });
    return Promise.race([event, deadline.promise]).finally(() => {
      remove?.();
      deadline.clear();
    });
  }

  close(error = new Error("CDP pipe closed")) {
    this.#fail(error);
  }

  #onData(chunk) {
    if (this.closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > this.maxFrameBytes && !this.buffer.includes(0)) {
      this.#fail(new Error("CDP response exceeds its frame limit"));
      return;
    }
    let delimiter = this.buffer.indexOf(0);
    while (delimiter !== -1) {
      const frame = this.buffer.subarray(0, delimiter);
      this.buffer = this.buffer.subarray(delimiter + 1);
      if (frame.length > this.maxFrameBytes) {
        this.#fail(new Error("CDP response exceeds its frame limit"));
        return;
      }
      if (frame.length > 0) this.#onFrame(frame);
      delimiter = this.buffer.indexOf(0);
    }
  }

  #onFrame(frame) {
    let message;
    try {
      message = JSON.parse(frame.toString("utf8"));
    } catch {
      this.#fail(new Error("CDP emitted malformed JSON"));
      return;
    }
    if (
      message !== null &&
      typeof message === "object" &&
      Number.isSafeInteger(message.id)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.#fail(new Error("CDP emitted an unexpected response ID"));
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          new Error(`CDP ${pending.method} failed: ${message.error.message}`),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message?.method !== "string") {
      this.#fail(new Error("CDP emitted an invalid event"));
      return;
    }
    for (const handler of this.handlers.get(message.method) ?? []) {
      try {
        handler(message.params ?? {}, message.sessionId);
      } catch (error) {
        this.#fail(error);
      }
    }
  }

  #fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.handlers.clear();
  }
}

function fileIdentity(metadata) {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    mtime_ms: metadata.mtimeMs,
    size: metadata.size,
  };
}

async function measuredRegularFile(path, expectedSha256, label) {
  const resolved = await realpath(path);
  const metadata = await lstat(resolved);
  if (
    resolved !== path ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > 512 * 1024 * 1024
  ) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  const bytes = await readFile(resolved);
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(`${label} SHA-256 does not match`);
  }
  return {
    identity: fileIdentity(metadata),
    path: resolved,
    sha256: expectedSha256,
  };
}

async function assertMeasuredFileUnchanged(file, label) {
  const resolved = await realpath(file.path);
  const metadata = await lstat(resolved);
  const currentIdentity = fileIdentity(metadata);
  if (
    resolved !== file.path ||
    canonicalJson(currentIdentity) !== canonicalJson(file.identity) ||
    sha256(await readFile(resolved)) !== file.sha256
  ) {
    throw new Error(`${label} changed during browser execution`);
  }
}

async function ensureEvidenceRoot(policy) {
  const laneRoot = await realpath(policy.lane_root);
  if (laneRoot !== policy.lane_root) {
    throw new Error("policy.lane_root must not use a symbolic path");
  }
  const laneMetadata = await lstat(laneRoot);
  if (!laneMetadata.isDirectory() || laneMetadata.isSymbolicLink()) {
    throw new Error("policy.lane_root must be a directory");
  }
  const segments = policy.evidence_path.split("/");
  let current = laneRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const final = index === segments.length - 1;
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (final || error?.code !== "EEXIST") throw error;
    }
    const resolved = await realpath(current);
    const metadata = await lstat(resolved);
    if (
      resolved !== current ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    ) {
      throw new Error("browser evidence path contains an unsafe directory");
    }
  }
  const rel = relative(laneRoot, current);
  if (
    rel !== policy.evidence_path.split("/").join(sep) ||
    rel.startsWith(`..${sep}`)
  ) {
    throw new Error("browser evidence path escaped the lane root");
  }
  return current;
}

export class EvidenceStore {
  constructor({ policy, root, sourceSha256, toolsSha256 }) {
    this.policy = policy;
    this.root = root;
    this.sourceSha256 = sourceSha256;
    this.toolsSha256 = toolsSha256;
    this.artifactSequence = 0;
    this.artifactBytes = 0;
    this.journalEntries = 0;
    this.journalBytes = 0;
    this.journalSaturated = false;
    this.lastJournalSha256 = "0".repeat(64);
    this.closed = false;
    this.pendingRecords = 0;
    this.recordQueue = Promise.resolve();
    this.toolCalls = 0;
  }

  async initialize() {
    await writeFile(
      join(this.root, "gateway-policy.json"),
      canonicalJson(this.policy),
      { flag: "wx", mode: 0o400 },
    );
    await writeFile(
      join(this.root, "tool-schemas.json"),
      canonicalJson(browserToolsForPhase(this.policy.phase)),
      { flag: "wx", mode: 0o400 },
    );
    await writeFile(
      join(this.root, "gateway-journal.jsonl"),
      "",
      { flag: "wx", mode: 0o600 },
    );
    await this.record("gateway_started", {
      policy_sha256: sha256(canonicalJson(this.policy)),
      source_sha256: this.sourceSha256,
      tools_sha256: this.toolsSha256,
    });
  }

  async artifact(kind, extension, bytes, maximumBytes) {
    if (this.closed) throw new Error("browser evidence is closed");
    const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (content.length > maximumBytes) {
      throw new Error(`${kind} exceeds its evidence byte limit`);
    }
    if (
      this.artifactBytes + content.length >
      this.policy.limits.max_artifact_bytes
    ) {
      throw new Error("browser evidence exceeds its aggregate byte limit");
    }
    this.artifactSequence += 1;
    const filename =
      `${String(this.artifactSequence).padStart(4, "0")}-${kind}.${extension}`;
    await writeFile(join(this.root, filename), content, {
      flag: "wx",
      mode: 0o400,
    });
    this.artifactBytes += content.length;
    return {
      bytes: content.length,
      path: `${this.policy.evidence_path}/${filename}`,
      sha256: sha256(content),
    };
  }

  beginToolCall() {
    if (this.closed) throw new Error("browser evidence is closed");
    if (this.journalSaturated) {
      throw new Error("browser evidence journal is saturated");
    }
    if (this.toolCalls >= this.policy.limits.max_tool_calls) {
      throw new Error("browser gateway exceeds its tool-call limit");
    }
    if (
      this.journalEntries + 1 >=
      this.policy.limits.max_journal_entries - this.pendingRecords
    ) {
      throw new Error("browser evidence cannot reserve its closure record");
    }
    this.toolCalls += 1;
  }

  async record(event, payload, { terminal = false } = {}) {
    if (this.closed) throw new Error("browser evidence is closed");
    if (!terminal && this.journalSaturated) {
      throw journalLimitError("browser evidence journal is saturated");
    }
    const maximum = terminal
      ? this.policy.limits.max_journal_entries
      : this.policy.limits.max_journal_entries - 1;
    if (
      this.journalEntries + this.pendingRecords + 1 >
      maximum
    ) {
      if (!terminal) this.journalSaturated = true;
      throw journalLimitError(
        "browser evidence journal exceeds its entry limit",
      );
    }
    this.pendingRecords += 1;
    const operation = this.recordQueue.then(async () => {
      this.pendingRecords -= 1;
      const sequence = this.journalEntries + 1;
      const unsigned = {
        event,
        payload,
        previous_sha256: this.lastJournalSha256,
        schema_version: 1,
        sequence,
      };
      const entry = {
        ...unsigned,
        entry_sha256: sha256(canonicalJson(unsigned)),
      };
      const line = canonicalJsonLine(entry);
      const lineBytes = Buffer.byteLength(line, "utf8");
      const aggregateMaximum = terminal
        ? this.policy.limits.max_journal_bytes
        : this.policy.limits.max_journal_bytes - MAX_JOURNAL_ENTRY_BYTES;
      if (
        lineBytes > MAX_JOURNAL_ENTRY_BYTES ||
        this.journalBytes + lineBytes > aggregateMaximum
      ) {
        if (!terminal) this.journalSaturated = true;
        throw journalLimitError(
          "browser evidence journal exceeds its byte limit",
        );
      }
      await appendFile(
        join(this.root, "gateway-journal.jsonl"),
        line,
      );
      this.journalEntries = sequence;
      this.journalBytes += lineBytes;
      this.lastJournalSha256 = entry.entry_sha256;
      return entry;
    });
    this.recordQueue = operation.catch((error) => {
      if (error?.code === "QA_GATEWAY_JOURNAL_LIMIT") return undefined;
      throw error;
    });
    return operation;
  }

  async close({ browser, status, violations }) {
    const finalViolations = [...violations];
    if (
      this.journalSaturated &&
      finalViolations.length < 64 &&
      !finalViolations.some(({ kind }) => kind === "journal-limit")
    ) {
      finalViolations.push({
        detail: "journal capacity was exceeded",
        kind: "journal-limit",
      });
    }
    const finalStatus = this.journalSaturated ? "invalid" : status;
    await this.record("gateway_closed", {
      pending_cdp_requests: browser.pending_cdp_requests,
      status: finalStatus,
      violations: finalViolations,
    }, { terminal: true });
    const closure = {
      browser: browser.identity,
      journal: {
        bytes: this.journalBytes,
        entries: this.journalEntries,
        last_sha256: this.lastJournalSha256,
        path: `${this.policy.evidence_path}/gateway-journal.jsonl`,
      },
      policy_sha256: sha256(canonicalJson(this.policy)),
      qualification: "not-evidence",
      request_sha256: this.policy.request_sha256,
      result: null,
      schema_version: 1,
      source_sha256: this.sourceSha256,
      status: finalStatus,
      tools_sha256: this.toolsSha256,
      verification_status: "unverified",
      violations: finalViolations,
    };
    const pendingPath = join(this.root, "gateway-close.pending.json");
    await writeFile(
      pendingPath,
      canonicalJson(closure),
      { flag: "wx", mode: 0o400 },
    );
    await chmod(join(this.root, "gateway-journal.jsonl"), 0o400);
    await rename(pendingPath, join(this.root, "gateway-close.json"));
    this.closed = true;
    return closure;
  }
}

function attributesMap(attributes = []) {
  const result = {};
  for (let index = 0; index < attributes.length; index += 2) {
    result[attributes[index]] = attributes[index + 1] ?? "";
  }
  return result;
}

function axValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && Object.hasOwn(value, "value")) {
    return axValue(value.value);
  }
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return null;
}

function axBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  if (value === undefined || value === null) return null;
  throw new Error(`browser ${label} state is invalid`);
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function boundsFromBox(box) {
  const quad = box?.model?.border;
  if (!Array.isArray(quad) || quad.length !== 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (
    ![left, right, top, bottom].every(Number.isFinite) ||
    right <= left ||
    bottom <= top
  ) {
    return null;
  }
  return {
    height: rounded(bottom - top),
    width: rounded(right - left),
    x: rounded(left),
    y: rounded(top),
  };
}

function boundedText(value, maximum = 512) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length <= maximum ? text : text.slice(0, maximum);
}

function exactArguments(value, expected, label) {
  assertExactKeys(value, expected, label);
  return value;
}

function assertSetControlValue(value) {
  if (
    !["string", "boolean"].includes(typeof value) ||
    (typeof value === "string" && value.length > 256)
  ) {
    throw new Error("set_control.value is invalid");
  }
  return value;
}

function assertControlId(value, label = "control_id") {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !CONTROL_ID.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateBrowserToolInvocation(policy, name, args) {
  assertBoundedString(name, "browser tool name", 64, 1);
  const available = new Set(
    browserToolsForPhase(policy.phase).map((tool) => tool.name),
  );
  if (!available.has(name)) {
    throw new Error(`browser tool is unavailable in ${policy.phase}`);
  }
  if (["capture_screenshot", "observe_page"].includes(name)) {
    exactArguments(args, [], `${name} arguments`);
  } else if (name === "activate_control") {
    exactArguments(args, ["control_id"], "activate_control arguments");
    assertControlId(args.control_id);
  } else {
    exactArguments(args, ["control_id", "value"], "set_control arguments");
    assertControlId(args.control_id);
    assertSetControlValue(args.value);
  }
  return {
    arguments: structuredClone(args),
    name,
  };
}

async function wait(milliseconds) {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export class BrowserGateway {
  constructor({
    cdp,
    evidence,
    policy,
    sessionId,
  }) {
    this.cdp = cdp;
    this.evidence = evidence;
    this.policy = policy;
    this.sessionId = sessionId;
    this.violations = [];
    this.consoleEntries = [];
    this.pendingEvents = new Set();
  }

  listTools() {
    return browserToolsForPhase(this.policy.phase);
  }

  async callTool(name, args) {
    assertBoundedString(name, "browser tool name", 64, 1);
    this.evidence.beginToolCall?.();
    const requestSha256 = sha256(
      canonicalJson({ arguments: args, name }),
    );
    const call = async () => {
      const invocation = validateBrowserToolInvocation(
        this.policy,
        name,
        args,
      );
      if (name === "observe_page") {
        return { result: await this.observePage() };
      }
      if (name === "capture_screenshot") {
        return await this.captureScreenshot();
      }
      if (name === "set_control") {
        return {
          result: await this.setControl(
            invocation.arguments.control_id,
            invocation.arguments.value,
          ),
        };
      }
      return {
        result: await this.activateControl(invocation.arguments.control_id),
      };
    };
    try {
      const output = await call();
      await this.evidence.record("tool_completed", {
        request_sha256: requestSha256,
        result_sha256: sha256(canonicalJson(output.result)),
        tool: name,
      });
      return output;
    } catch (error) {
      await this.evidence.record("tool_failed", {
        error: boundedText(error.message, 256),
        request_sha256: requestSha256,
        tool: name,
      });
      throw error;
    }
  }

  trackEvent(promise) {
    this.pendingEvents.add(promise);
    promise.then(
      () => this.pendingEvents.delete(promise),
      (error) => {
        this.pendingEvents.delete(promise);
        this.violation("event-handler", error.message);
      },
    );
  }

  violation(kind, detail) {
    if (this.violations.length >= 64) return;
    this.violations.push({
      detail: boundedText(detail, 256),
      kind,
    });
  }

  recordConsole(kind, text) {
    if (this.consoleEntries.length === 64) {
      this.consoleEntries.shift();
    }
    this.consoleEntries.push({
      kind: boundedText(kind, 64) ?? "log",
      text: boundedText(text, 512) ?? "",
    });
  }

  async settleEvents() {
    await Promise.allSettled([...this.pendingEvents]);
  }

  assertHealthy() {
    if (this.violations.length > 0) {
      throw new Error(
        `browser gateway recorded ${this.violations.length} policy violation(s): ` +
        this.violations
          .map(({ detail, kind }) => `${kind}(${detail})`)
          .join(", "),
      );
    }
  }

  async send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async inventory() {
    await this.settleEvents();
    this.assertHealthy();
    const document = await this.send("DOM.getDocument", {
      depth: 0,
      pierce: false,
    });
    const rootNodeId = document.root?.nodeId;
    if (!Number.isSafeInteger(rootNodeId)) {
      throw new Error("browser DOM root is unavailable");
    }
    const surfaceQuery = await this.send("DOM.querySelectorAll", {
      nodeId: rootNodeId,
      selector: "[data-surface-id]",
    });
    const surfaceNodeIds = assertDenseArray(
      surfaceQuery.nodeIds ?? [],
      "browser surface candidates",
      { maximum: MAX_SURFACES, minimum: 1 },
    );
    if (!surfaceNodeIds.every(Number.isSafeInteger)) {
      throw new Error("browser surface candidate IDs are invalid");
    }
    const surfaces = [];
    const controls = [];
    const internalControls = new Map();
    const seenSurfaceIds = new Set();
    for (const surfaceNodeId of surfaceNodeIds) {
      const describedSurface = await this.send("DOM.describeNode", {
        depth: 0,
        nodeId: surfaceNodeId,
        pierce: false,
      });
      const surfaceAttributes = attributesMap(
        describedSurface.node?.attributes,
      );
      const surfaceId = surfaceAttributes["data-surface-id"];
      if (
        typeof surfaceId !== "string" ||
        surfaceId.length === 0 ||
        surfaceId.length > 128 ||
        seenSurfaceIds.has(surfaceId)
      ) {
        throw new Error("browser surface ID is invalid or duplicated");
      }
      seenSurfaceIds.add(surfaceId);
      const controlQuery = await this.send("DOM.querySelectorAll", {
        nodeId: surfaceNodeId,
        selector: "[data-control-id]",
      });
      const controlNodeIds = assertDenseArray(
        controlQuery.nodeIds ?? [],
        "browser control candidates",
        { maximum: MAX_CONTROL_CANDIDATES },
      );
      if (!controlNodeIds.every(Number.isSafeInteger)) {
        throw new Error("browser control candidate IDs are invalid");
      }
      const surfaceControlIds = [];
      for (const controlNodeId of controlNodeIds) {
        const control = await this.#controlFromNode(controlNodeId, surfaceId);
        if (control === null) continue;
        if (
          internalControls.has(control.public.id) ||
          controls.length >= MAX_CONTROLS
        ) {
          throw new Error("browser control IDs are invalid or duplicated");
        }
        controls.push(control.public);
        internalControls.set(control.public.id, control);
        surfaceControlIds.push(control.public.id);
      }
      surfaces.push({
        control_ids: surfaceControlIds,
        id: surfaceId,
      });
    }
    const ax = await this.send("Accessibility.getFullAXTree", {});
    const headings = [];
    const visibleText = [];
    let visibleTextBytes = 0;
    for (const node of ax.nodes ?? []) {
      if (node.ignored) continue;
      const role = boundedText(axValue(node.role), 64);
      const name = boundedText(axValue(node.name), 1024);
      if (!name) continue;
      if (role === "heading" && headings.length < MAX_HEADINGS) {
        headings.push(name);
      }
      if (
        ["StaticText", "paragraph", "status"].includes(role) &&
        visibleText.length < MAX_VISIBLE_TEXT_ITEMS
      ) {
        const bytes = Buffer.byteLength(name, "utf8");
        if (visibleTextBytes + bytes <= MAX_TEXT_BYTES) {
          visibleText.push(name);
          visibleTextBytes += bytes;
        }
      }
    }
    const currentEntry = await this.currentNavigationEntry();
    const snapshot = {
      console: this.consoleEntries.slice(-64),
      controls,
      headings,
      schema_version: 1,
      surfaces,
      title: boundedText(currentEntry?.title, 512) ?? "",
      url: currentEntry?.url ?? "",
      viewport: structuredClone(this.policy.viewport),
      visible_text: visibleText,
    };
    if (snapshot.url !== this.policy.target_url) {
      this.violation("url-drift", snapshot.url);
      this.assertHealthy();
    }
    return { internalControls, snapshot };
  }

  async currentNavigationEntry() {
    const navigation = await this.send("Page.getNavigationHistory", {});
    const currentEntry = navigation.entries?.[navigation.currentIndex];
    if (
      typeof currentEntry?.title !== "string" ||
      typeof currentEntry?.url !== "string"
    ) {
      throw new Error("browser navigation entry is unavailable");
    }
    return currentEntry;
  }

  async verifyTargetUrl() {
    const currentEntry = await this.currentNavigationEntry();
    if (currentEntry.url !== this.policy.target_url) {
      this.violation("url-drift", currentEntry.url);
    }
    return currentEntry;
  }

  async observePage() {
    const { snapshot } = await this.inventory();
    return this.#persistSnapshot(snapshot);
  }

  async #persistSnapshot(snapshot) {
    const source = canonicalJson(snapshot);
    const artifact = await this.evidence.artifact(
      "semantic-snapshot",
      "json",
      source,
      this.policy.limits.max_snapshot_bytes,
    );
    return {
      ...snapshot,
      artifact,
    };
  }

  async captureScreenshot() {
    await this.settleEvents();
    this.assertHealthy();
    const captured = await this.send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png",
      fromSurface: true,
    });
    if (typeof captured.data !== "string") {
      throw new Error("browser screenshot is missing");
    }
    const bytes = Buffer.from(captured.data, "base64");
    const artifact = await this.evidence.artifact(
      "viewport",
      "png",
      bytes,
      this.policy.limits.max_screenshot_bytes,
    );
    const result = {
      artifact,
      height: this.policy.viewport.height,
      mime_type: "image/png",
      schema_version: 1,
      width: this.policy.viewport.width,
    };
    return {
      image: {
        data: bytes.toString("base64"),
        mimeType: "image/png",
      },
      result,
    };
  }

  async setControl(controlId, value) {
    assertControlId(controlId);
    assertSetControlValue(value);
    const before = await this.#controlForAction(controlId);
    const internal = await this.#refreshControlForAction(before.internal);
    if (typeof value === "boolean") {
      if (internal.public.type !== "checkbox") {
        throw new Error("boolean values require a checkbox control");
      }
      if (typeof internal.public.state.checked !== "boolean") {
        throw new Error("checkbox state is unavailable");
      }
      if (internal.public.state.checked !== value) {
        await this.#click(internal);
      }
    } else if (internal.public.tag === "select") {
      await this.#assertHitTarget(internal);
      await this.#setSelect(internal, value);
    } else if (
      internal.public.tag === "textarea" ||
      (
        internal.public.tag === "input" &&
        ["email", "search", "text", "url"].includes(internal.public.type)
      )
    ) {
      await this.#assertHitTarget(internal);
      await this.send("DOM.focus", { nodeId: internal.nodeId });
      await this.#key({
        code: "KeyA",
        key: "a",
        modifiers: process.platform === "darwin" ? 4 : 2,
        windowsVirtualKeyCode: 65,
      });
      await this.send("Input.insertText", { text: value });
    } else {
      throw new Error("set_control does not support this control type");
    }
    await wait(25);
    return this.#actionReceipt("set", controlId, before.artifact);
  }

  async activateControl(controlId) {
    assertControlId(controlId);
    const before = await this.#controlForAction(controlId);
    const internal = await this.#refreshControlForAction(before.internal);
    await this.#click(internal);
    await wait(25);
    return this.#actionReceipt("activate", controlId, before.artifact);
  }

  async #actionReceipt(action, controlId, beforeArtifact) {
    const after = await this.observePage();
    const receipt = {
      action,
      after_snapshot_sha256: after.artifact.sha256,
      before_snapshot_sha256: beforeArtifact.sha256,
      control_id: controlId,
      schema_version: 1,
      url: after.url,
    };
    const artifact = await this.evidence.artifact(
      "action-receipt",
      "json",
      canonicalJson(receipt),
      this.policy.limits.max_snapshot_bytes,
    );
    return { ...receipt, artifact };
  }

  async #controlForAction(controlId) {
    const { internalControls, snapshot } = await this.inventory();
    let internal = internalControls.get(controlId);
    if (!internal) {
      throw new Error("control is not currently visible and actionable");
    }
    if (internal.public.state.disabled) {
      throw new Error("control is not currently actionable");
    }
    await this.send("DOM.scrollIntoViewIfNeeded", {
      nodeId: internal.nodeId,
    });
    internal = await this.#refreshControlForAction(internal);
    const controlIndex = snapshot.controls.findIndex(
      ({ id }) => id === controlId,
    );
    if (controlIndex < 0) {
      throw new Error("control snapshot binding is unavailable");
    }
    snapshot.controls[controlIndex] = internal.public;
    const observed = await this.#persistSnapshot(snapshot);
    return { artifact: observed.artifact, internal };
  }

  async #refreshControlForAction(expected) {
    const current = await this.#controlFromNode(
      expected.nodeId,
      expected.public.surface_id,
    );
    if (
      current === null ||
      current.public.id !== expected.public.id ||
      current.public.state.disabled ||
      current.public.bounds.width <= 0 ||
      current.public.bounds.height <= 0 ||
      current.public.bounds.x + current.public.bounds.width / 2 < 0 ||
      current.public.bounds.x + current.public.bounds.width / 2 >
        this.policy.viewport.width ||
      current.public.bounds.y + current.public.bounds.height / 2 < 0 ||
      current.public.bounds.y + current.public.bounds.height / 2 >
        this.policy.viewport.height
    ) {
      throw new Error("control changed before the requested action");
    }
    return current;
  }

  async #controlFromNode(nodeId, surfaceId) {
    let box;
    try {
      box = await this.send("DOM.getBoxModel", { nodeId });
    } catch {
      return null;
    }
    const bounds = boundsFromBox(box);
    if (bounds === null) return null;
    const described = await this.send("DOM.describeNode", {
      depth: 1,
      nodeId,
      pierce: false,
    });
    const node = described.node;
    const attributes = attributesMap(node?.attributes);
    const id = attributes["data-control-id"];
    assertControlId(id, "inventoried control ID");
    const ax = await this.send("Accessibility.getPartialAXTree", {
      fetchRelatives: false,
      nodeId,
    });
    const axNode = (ax.nodes ?? []).find(
      (candidate) =>
        candidate.backendDOMNodeId === node?.backendNodeId &&
        !candidate.ignored,
    ) ?? (ax.nodes ?? []).find((candidate) => !candidate.ignored);
    if (!axNode) return null;
    const properties = Object.fromEntries(
      (axNode.properties ?? []).map((property) => [
        property.name,
        axValue(property.value),
      ]),
    );
    const tag = String(node.localName ?? node.nodeName ?? "").toLowerCase();
    const type = tag === "input"
      ? (attributes.type ?? "text").toLowerCase()
      : tag;
    const publicControl = {
      bounds,
      id,
      name: boundedText(axValue(axNode.name), 512) ?? "",
      role: boundedText(axValue(axNode.role), 64) ?? "",
      state: {
        checked: axBoolean(properties.checked, "checked"),
        disabled: axBoolean(properties.disabled, "disabled") ?? false,
        expanded: properties.expanded ?? null,
        focusable: axBoolean(properties.focusable, "focusable") ?? false,
        required: axBoolean(properties.required, "required") ?? false,
      },
      surface_id: surfaceId,
      tag,
      type,
      value: boundedText(axValue(axNode.value), 512),
    };
    return {
      backendNodeId: node.backendNodeId,
      nodeId,
      public: publicControl,
    };
  }

  async #click(control) {
    await this.#assertHitTarget(control);
    const x = control.public.bounds.x + control.public.bounds.width / 2;
    const y = control.public.bounds.y + control.public.bounds.height / 2;
    await this.send("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type: "mousePressed",
      x,
      y,
    });
    await this.send("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type: "mouseReleased",
      x,
      y,
    });
  }

  async #assertHitTarget(control) {
    const viewportX =
      control.public.bounds.x + control.public.bounds.width / 2;
    const viewportY =
      control.public.bounds.y + control.public.bounds.height / 2;
    const metrics = await this.send("Page.getLayoutMetrics", {});
    const pageX = metrics.cssVisualViewport?.pageX;
    const pageY = metrics.cssVisualViewport?.pageY;
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) {
      throw new Error("browser viewport offset is unavailable");
    }
    const hit = await this.send("DOM.getNodeForLocation", {
      ignorePointerEventsNone: false,
      includeUserAgentShadowDOM: false,
      x: Math.floor(viewportX + pageX),
      y: Math.floor(viewportY + pageY),
    });
    if (hit.backendNodeId === control.backendNodeId) return;
    const described = await this.send("DOM.describeNode", {
      depth: -1,
      nodeId: control.nodeId,
      pierce: false,
    });
    const pending = [described.node];
    for (let inspected = 0; inspected < pending.length; inspected += 1) {
      if (inspected >= 256) break;
      const node = pending[inspected];
      if (!node) continue;
      if (
        node.nodeId === hit.nodeId ||
        node.backendNodeId === hit.backendNodeId
      ) {
        return;
      }
      const descendants = [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
        ...(node.pseudoElements ?? []),
        node.contentDocument,
        node.templateContent,
      ].filter(Boolean);
      pending.push(...descendants.slice(0, 256 - pending.length));
    }
    throw new Error("control is occluded at its interaction point");
  }

  async #key({
    code,
    key,
    modifiers = 0,
    windowsVirtualKeyCode,
  }) {
    const base = {
      code,
      key,
      modifiers,
      windowsVirtualKeyCode,
    };
    await this.send("Input.dispatchKeyEvent", {
      ...base,
      type: "rawKeyDown",
    });
    await this.send("Input.dispatchKeyEvent", {
      ...base,
      type: "keyUp",
    });
  }

  async #setSelect(control, value) {
    const options = await this.send("DOM.querySelectorAll", {
      nodeId: control.nodeId,
      selector: "option",
    });
    const optionNodeIds = assertDenseArray(
      options.nodeIds ?? [],
      "browser select options",
      { maximum: MAX_OPTIONS },
    );
    if (!optionNodeIds.every(Number.isSafeInteger)) {
      throw new Error("browser select option IDs are invalid");
    }
    const optionValues = [];
    for (const optionNodeId of optionNodeIds) {
      const described = await this.send("DOM.describeNode", {
        depth: 0,
        nodeId: optionNodeId,
        pierce: false,
      });
      optionValues.push(
        attributesMap(described.node?.attributes).value ?? "",
      );
    }
    const selectedIndex = optionValues.indexOf(value);
    if (selectedIndex < 0) {
      throw new Error("set_control value is not a declared select option");
    }
    await this.send("DOM.focus", { nodeId: control.nodeId });
    await this.#key({
      code: "Home",
      key: "Home",
      windowsVirtualKeyCode: 36,
    });
    for (let index = 0; index < selectedIndex; index += 1) {
      await this.#key({
        code: "ArrowDown",
        key: "ArrowDown",
        windowsVirtualKeyCode: 40,
      });
    }
    await this.#key({
      code: "Enter",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }

  isAllowedUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const target = new URL(this.policy.target_url);
    return (
      url.protocol === "http:" &&
      url.origin === target.origin &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      this.policy.allowed_paths.includes(url.pathname)
    );
  }

  isAutomaticBrowserRequest(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const target = new URL(this.policy.target_url);
    return (
      url.protocol === "http:" &&
      url.origin === target.origin &&
      url.pathname === "/favicon.ico" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export function assertBrowserProcessGroupSupport(
  platform = process.platform,
) {
  if (platform === "win32") {
    throw new Error(
      "browser process-group cleanup is unsupported on win32",
    );
  }
}

async function waitForEmptyProcessGroup(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      if (error?.code !== "EPERM") throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, Math.min(25, remaining))
    );
  }
}

const PROCESS_GROUP_CONTROL = Object.freeze({
  platform: process.platform,
  signal: signalProcessGroup,
  waitForEmpty: waitForEmptyProcessGroup,
});

export async function terminateProcessGroup(
  child,
  processGroup = PROCESS_GROUP_CONTROL,
) {
  if (!child) return true;
  if (processGroup.platform !== undefined) {
    assertBrowserProcessGroupSupport(processGroup.platform);
  }
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
    throw new Error("browser process group ID is invalid");
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error("browser leader exited before process-group cleanup");
  }
  processGroup.signal(child.pid, "SIGTERM");
  if (await processGroup.waitForEmpty(child.pid, 1500)) return true;
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(
      "browser leader exited before process-group cleanup completed",
    );
  }
  processGroup.signal(child.pid, "SIGKILL");
  if (await processGroup.waitForEmpty(child.pid, 500)) return true;
  throw new Error("browser process group did not become empty");
}

async function closeBrowserProcessGroup(child, gateway) {
  try {
    return await terminateProcessGroup(child);
  } catch (error) {
    gateway.violation(
      "browser-process-cleanup",
      boundedText(error.message, 256) ??
        "browser process group did not become empty",
    );
    return false;
  }
}

export async function removeBrowserProfileIfSafe({
  processGroupEmpty,
  profile,
  removeProfile = rm,
}) {
  if (profile === null) return true;
  if (!processGroupEmpty) return false;
  await removeProfile(profile, { force: true, recursive: true });
  return true;
}

function measuredBrowserIdentity({ args, chrome, stderr, version }) {
  const identity = {
    arguments_sha256: sha256(canonicalJson(args)),
    executable_sha256: chrome.sha256,
    js_version: boundedText(version.jsVersion, 2048) ?? "",
    product: boundedText(version.product, 2048) ?? "",
    protocol_version: boundedText(version.protocolVersion, 2048) ?? "",
    revision: boundedText(version.revision, 2048) ?? "",
    user_agent: boundedText(version.userAgent, 2048) ?? "",
  };
  if (stderr !== undefined) {
    identity.stderr_bytes = stderr.length;
    identity.stderr_sha256 = sha256(stderr);
  }
  return identity;
}

function journalRequestReference(value, maximum) {
  const text = String(value ?? "");
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256(Buffer.from(text, "utf8")),
    text: boundedText(text, maximum) ?? "",
  };
}

function parseBrowserSupervisorConfig(source) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > MAX_POLICY_BYTES
  ) {
    throw new Error("browser supervisor config source is invalid");
  }
  const value = parseContractJson(source, "browser supervisor config");
  if (source !== canonicalJson(value)) {
    throw new Error("browser supervisor config must use canonical JSON");
  }
  assertExactKeys(
    value,
    ["arguments", "executable"],
    "browser supervisor config",
  );
  const args = assertDenseArray(
    value.arguments,
    "browser supervisor config.arguments",
    { maximum: 64, minimum: 1 },
  ).map((argument, index) =>
    assertBoundedString(
      argument,
      `browser supervisor config.arguments[${index}]`,
      4096,
      1,
    )
  );
  return {
    arguments: args,
    executable: assertAbsolutePath(
      value.executable,
      "browser supervisor config.executable",
    ),
  };
}

function killBrowserSupervisorGroup() {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function runBrowserSupervisor(source) {
  assertBrowserProcessGroupSupport();
  const config = parseBrowserSupervisorConfig(source);
  let livenessLost = false;
  const terminateOwnedGroup = () => {
    if (livenessLost) return;
    livenessLost = true;
    killBrowserSupervisorGroup();
  };
  process.stdin.once("end", terminateOwnedGroup);
  process.stdin.once("close", terminateOwnedGroup);
  process.stdin.once("error", terminateOwnedGroup);
  process.stdin.resume();

  // The gateway performs the graceful group signal. Keeping the leader alive
  // until escalation prevents reuse of an unowned process-group identifier.
  process.on("SIGTERM", () => {});

  let browser;
  try {
    browser = spawn(config.executable, config.arguments, {
      detached: false,
      env: { ...FIXED_ENVIRONMENT },
      shell: false,
      stdio: ["ignore", "ignore", "inherit", 3, 4],
      windowsHide: true,
    });
  } finally {
    closeSync(3);
    closeSync(4);
  }
  browser.once("error", (error) => {
    process.stderr.write(`Chrome launch failed: ${error.message}\n`);
  });
}

function spawnBrowserSupervisor(chrome, args) {
  const config = canonicalJson({
    arguments: args,
    executable: chrome.path,
  });
  const child = spawn(
    process.execPath,
    [SOURCE_PATH, BROWSER_SUPERVISOR_MODE],
    {
      detached: true,
      env: {
        ...FIXED_ENVIRONMENT,
        [BROWSER_SUPERVISOR_CONFIG]: config,
      },
      shell: false,
      stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdin.on("error", () => {});
  return child;
}

class BrowserDenyProxy {
  constructor(timeoutMs) {
    this.audit = {
      connect: 0,
      http: 0,
      malformed: 0,
      overflow: 0,
      upgrade: 0,
    };
    this.failure = null;
    this.lastSha256 = sha256(canonicalJson({ schema_version: 1 }));
    this.observedEvents = 0;
    this.port = null;
    this.sockets = new Set();
    this.server = createServer((request, response) => {
      this.#record("http", request.method, request.url);
      response.shouldKeepAlive = false;
      response.writeHead(403, {
        "Connection": "close",
        "Content-Length": "0",
      });
      response.end();
    });
    this.server.maxHeadersCount = 64;
    this.server.headersTimeout = timeoutMs;
    this.server.keepAliveTimeout = 1000;
    this.server.requestTimeout = timeoutMs;
    this.server.on("connect", (request, socket) => {
      this.#record("connect", request.method, request.url);
      this.#denySocket(socket);
    });
    this.server.on("upgrade", (request, socket) => {
      this.#record("upgrade", request.method, request.url);
      this.#denySocket(socket);
    });
    this.server.on("clientError", (error, socket) => {
      this.#record("malformed", "", error.code ?? error.message);
      if (socket.writable) {
        socket.end(
          "HTTP/1.1 400 Bad Request\r\n" +
          "Connection: close\r\nContent-Length: 0\r\n\r\n",
        );
      } else {
        socket.destroy();
      }
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("error", (error) => {
        this.#record("malformed", "", error.code ?? error.message);
      });
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("error", (error) => {
      this.failure ??= error;
    });
  }

  async start() {
    this.server.listen({
      exclusive: true,
      host: "127.0.0.1",
      port: 0,
    });
    await once(this.server, "listening");
    const address = this.server.address();
    if (
      address === null ||
      typeof address === "string" ||
      address.address !== "127.0.0.1" ||
      !Number.isSafeInteger(address.port)
    ) {
      throw new Error("browser deny proxy did not bind numeric loopback");
    }
    this.port = address.port;
  }

  assertHealthy() {
    if (this.failure !== null) {
      throw new Error(`browser deny proxy failed: ${this.failure.message}`);
    }
  }

  endpoint() {
    if (!Number.isSafeInteger(this.port)) {
      throw new Error("browser deny proxy is not listening");
    }
    return `http://127.0.0.1:${this.port}`;
  }

  summary() {
    return {
      denied: { ...this.audit },
      last_sha256: this.lastSha256,
      observed_events: this.observedEvents,
      schema_version: 1,
    };
  }

  async close() {
    if (!this.server.listening) {
      for (const socket of this.sockets) socket.destroy();
      return;
    }
    const closed = once(this.server, "close");
    this.server.close();
    for (const socket of this.sockets) socket.destroy();
    const deadline = timeoutAfter(1500, "browser deny proxy close timed out");
    try {
      await Promise.race([closed, deadline.promise]);
    } finally {
      deadline.clear();
    }
  }

  #denySocket(socket) {
    if (socket.writable) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\n" +
        "Connection: close\r\nContent-Length: 0\r\n\r\n",
      );
    } else {
      socket.destroy();
    }
  }

  #record(kind, method, url) {
    this.observedEvents = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.observedEvents + 1,
    );
    if (this.observedEvents > MAX_PROXY_AUDIT_EVENTS) {
      this.audit.overflow = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.audit.overflow + 1,
      );
      return;
    }
    this.audit[kind] += 1;
    const methodReference = journalRequestReference(method, 32);
    const urlReference = journalRequestReference(url, 2048);
    this.lastSha256 = sha256(canonicalJson({
      kind,
      method_bytes: methodReference.bytes,
      method_sha256: methodReference.sha256,
      previous_sha256: this.lastSha256,
      url_bytes: urlReference.bytes,
      url_sha256: urlReference.sha256,
    }));
  }
}

async function launchBrowser(policy, evidence, chrome) {
  const proxy = new BrowserDenyProxy(policy.limits.cdp_timeout_ms);
  const targetOrigin = new URL(policy.target_url).origin;
  let args = [];
  let profile = null;
  let stderr = Buffer.alloc(0);
  let stderrOverflow = false;
  let version = {};
  const closeStartupFailure = async (error, pendingCdpRequests = 0) => {
    const violations = [{
      detail: boundedText(error.message, 256) ?? "browser startup failed",
      kind: "browser-startup",
    }];
    if (stderrOverflow) {
      violations.push({
        detail: "stderr exceeded limit",
        kind: "browser-stderr-overflow",
      });
    }
    const closure = await evidence.close({
      browser: {
        identity: measuredBrowserIdentity({
          args,
          chrome,
          stderr,
          version,
        }),
        pending_cdp_requests: pendingCdpRequests,
      },
      status: "invalid",
      violations,
    });
    validateBrowserGatewayClosure(closure);
  };
  const closeProxy = async () => {
    let failure = null;
    try {
      await proxy.close();
    } catch (error) {
      failure = error;
    }
    try {
      proxy.assertHealthy();
    } catch (error) {
      failure ??= error;
    }
    try {
      await evidence.record("browser_proxy_summary", proxy.summary());
    } catch (error) {
      failure ??= error;
    }
    return failure;
  };
  const closeFailedLaunch = async ({ cdp, child, error }) => {
    cdp?.close();
    let startupError = error;
    let processGroupEmpty = false;
    try {
      processGroupEmpty = await terminateProcessGroup(child);
    } catch (cleanupError) {
      startupError = new Error(
        `${startupError.message}; browser process cleanup failed: ` +
        cleanupError.message,
      );
    }
    const proxyError = await closeProxy();
    if (proxyError !== null) {
      startupError = new Error(
        `${startupError.message}; proxy cleanup failed: ${proxyError.message}`,
      );
    }
    if (profile !== null) {
      try {
        const profileRemoved = await removeBrowserProfileIfSafe({
          processGroupEmpty,
          profile,
        });
        if (!profileRemoved) {
          startupError = new Error(
            `${startupError.message}; browser profile retained because ` +
            "process-group cleanup was not proven",
          );
        }
      } catch (cleanupError) {
        startupError = new Error(
          `${startupError.message}; profile cleanup failed: ` +
          cleanupError.message,
        );
      }
    }
    await closeStartupFailure(startupError, cdp?.pending.size ?? 0);
    return startupError;
  };
  try {
    await assertMeasuredFileUnchanged(chrome, "Chrome executable");
    assertBrowserProcessGroupSupport();
    profile = await mkdtemp(join(tmpdir(), "qa-suite-browser-"));
    await proxy.start();
  } catch (error) {
    throw await closeFailedLaunch({ error });
  }
  args = [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-extensions-with-background-pages",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=InitialWebUI",
    "--disable-sync",
    "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-search-engine-choice-screen",
    "--disable-quic",
    "--no-pings",
    "--no-startup-window",
    `--proxy-server=${proxy.endpoint()}`,
    `--proxy-bypass-list=<-loopback>;${targetOrigin}`,
    `--window-size=${policy.viewport.width},${policy.viewport.height}`,
    `--force-device-scale-factor=${policy.viewport.device_scale_factor}`,
  ];
  const child = spawnBrowserSupervisor(chrome, args);
  const spawned = once(child, "spawn");
  child.stderr.on("data", (chunk) => {
    if (stderr.length + chunk.length > MAX_BROWSER_STDERR_BYTES) {
      stderrOverflow = true;
      return;
    }
    stderr = Buffer.concat([stderr, chunk]);
  });
  try {
    await spawned;
  } catch (error) {
    throw await closeFailedLaunch({ child, error });
  }
  const cdp = new CdpPipeClient({
    input: child.stdio[4],
    output: child.stdio[3],
    timeoutMs: policy.limits.cdp_timeout_ms,
  });
  child.once("error", (error) => cdp.close(error));
  child.once("exit", () => cdp.close());
  let browserContextId;
  let targetId;
  let sessionId;
  const relevantTargets = new Map();
  let gateway;
  const targetHandler = (params) => {
    const target = params.targetInfo;
    if (
      ["page", "service_worker", "shared_worker", "worker"].includes(
        target?.type,
      )
    ) {
      if (relevantTargets.size < 256) {
        relevantTargets.set(target.targetId, target);
      }
      if (
        browserContextId &&
        target.browserContextId === browserContextId &&
        targetId &&
        target.targetId !== targetId
      ) {
        gateway?.violation("extra-target", target.url ?? target.targetId);
      }
    }
  };
  cdp.on("Target.targetCreated", targetHandler);
  try {
    version = await cdp.send("Browser.getVersion");
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const context = await cdp.send("Target.createBrowserContext", {
      disposeOnDetach: true,
    });
    browserContextId = context.browserContextId;
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "deny",
      browserContextId,
      eventsEnabled: true,
    });
    const target = await cdp.send("Target.createTarget", {
      browserContextId,
      height: policy.viewport.height,
      url: "about:blank",
      width: policy.viewport.width,
    });
    targetId = target.targetId;
    const attached = await cdp.send("Target.attachToTarget", {
      flatten: true,
      targetId,
    });
    sessionId = attached.sessionId;
    const browserIdentity = measuredBrowserIdentity({
      args,
      chrome,
      version,
    });
    gateway = new BrowserGateway({
      cdp,
      evidence,
      policy,
      sessionId,
    });
    for (const observedTarget of relevantTargets.values()) {
      if (
        observedTarget.browserContextId === browserContextId &&
        observedTarget.targetId !== targetId
      ) {
        gateway.violation("extra-target", observedTarget.url);
      }
    }
    relevantTargets.clear();
    const sessionSend = (method, params = {}) =>
      cdp.send(method, params, sessionId);
    const trackEvent = (promise) => {
      gateway.trackEvent(promise);
    };
    let controllerNavigationStarted = false;
    let mainFrameId;
    cdp.on("Target.attachedToTarget", (params) => {
      const target = params.targetInfo;
      const attachedSessionId = params.sessionId;
      if (
        !target ||
        typeof attachedSessionId !== "string" ||
        target.browserContextId !== browserContextId
      ) {
        return;
      }
      if (target.targetId === targetId) {
        trackEvent(
          cdp.send(
            "Runtime.runIfWaitingForDebugger",
            {},
            attachedSessionId,
          ),
        );
        return;
      }
      gateway.violation("extra-target", target.url ?? target.targetId);
      trackEvent(
        cdp.send("Target.closeTarget", { targetId: target.targetId }),
      );
    });
    await cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
    });
    cdp.on("Fetch.requestPaused", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      const request = params.request ?? {};
      const allowed =
        request.method === "GET" &&
        gateway.isAllowedUrl(request.url);
      const automatic = !allowed &&
        request.method === "GET" &&
        gateway.isAutomaticBrowserRequest(request.url);
      if (!allowed && !automatic) {
        gateway.violation("blocked-request", request.url ?? "invalid URL");
      }
      const response = (async () => {
        const method = journalRequestReference(request.method, 32);
        const url = journalRequestReference(request.url, 2048);
        await evidence.record("page_request", {
          decision: allowed
            ? "continued"
            : automatic
              ? "browser-default-fulfilled"
              : "policy-denied",
          method: method.text,
          method_bytes: method.bytes,
          method_sha256: method.sha256,
          url: url.text,
          url_bytes: url.bytes,
          url_sha256: url.sha256,
        });
        if (allowed) {
          await sessionSend("Fetch.continueRequest", {
            requestId: params.requestId,
          });
        } else if (automatic) {
          await sessionSend("Fetch.fulfillRequest", {
            body: "",
            requestId: params.requestId,
            responseCode: 204,
            responseHeaders: [{
              name: "Content-Length",
              value: "0",
            }],
          });
        } else {
          await sessionSend("Fetch.failRequest", {
            errorReason: "BlockedByClient",
            requestId: params.requestId,
          });
        }
      })();
      trackEvent(response);
    });
    cdp.on("Page.javascriptDialogOpening", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      gateway.violation("dialog", params.message ?? "");
      trackEvent(
        sessionSend("Page.handleJavaScriptDialog", { accept: false }),
      );
    });
    cdp.on("Page.windowOpen", (params, eventSessionId) => {
      if (eventSessionId === sessionId) {
        gateway.violation("popup", params.url ?? "");
      }
    });
    cdp.on("Page.frameNavigated", (params, eventSessionId) => {
      const frame = params.frame;
      if (
        controllerNavigationStarted &&
        eventSessionId === sessionId &&
        !frame?.parentId &&
        frame?.url !== policy.target_url
      ) {
        gateway.violation("url-drift", frame?.url ?? "missing URL");
      }
    });
    cdp.on("Page.navigatedWithinDocument", (params, eventSessionId) => {
      if (
        controllerNavigationStarted &&
        eventSessionId === sessionId &&
        params.frameId === mainFrameId &&
        params.url !== policy.target_url
      ) {
        gateway.violation("url-drift", params.url ?? "missing URL");
      }
    });
    const recordNonHttpRequest = (kind, url) => {
      const reference = journalRequestReference(url, 2048);
      gateway.violation(kind, reference.text);
      trackEvent(
        evidence.record("non_http_request", {
          kind,
          url: reference.text,
          url_bytes: reference.bytes,
          url_sha256: reference.sha256,
        }),
      );
    };
    cdp.on("Network.webSocketCreated", (params, eventSessionId) => {
      if (eventSessionId === sessionId) {
        recordNonHttpRequest("websocket", params.url);
      }
    });
    cdp.on("Network.webTransportCreated", (params, eventSessionId) => {
      if (eventSessionId === sessionId) {
        recordNonHttpRequest("webtransport", params.url);
      }
    });
    cdp.on("Network.directTCPSocketCreated", (params, eventSessionId) => {
      if (eventSessionId === sessionId) {
        recordNonHttpRequest(
          "direct-socket",
          `${params.remoteAddr ?? ""}:${params.remotePort ?? ""}`,
        );
      }
    });
    cdp.on("Browser.downloadWillBegin", (params) => {
      gateway.violation("download", params.url ?? "");
    });
    cdp.on("Inspector.targetCrashed", (_, eventSessionId) => {
      if (eventSessionId === sessionId) {
        gateway.violation("browser-crash", "page target crashed");
      }
    });
    cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      const text = boundedText(params.exceptionDetails?.text, 512) ?? "";
      gateway.recordConsole("exception", text);
      trackEvent(
        evidence.record("browser_console", {
          kind: "exception",
          text,
        }),
      );
    });
    cdp.on("Log.entryAdded", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      const kind = boundedText(params.entry?.level, 64) ?? "log";
      const text = boundedText(params.entry?.text, 512) ?? "";
      gateway.recordConsole(kind, text);
      trackEvent(evidence.record("browser_console", { kind, text }));
    });
    await sessionSend("Network.enable");
    await sessionSend("Network.setBlockedURLs", {
      urls: ["ws://*", "wss://*"],
    });
    await Promise.all([
      sessionSend("Page.enable"),
      sessionSend("DOM.enable"),
      sessionSend("Accessibility.enable"),
      sessionSend("Runtime.enable"),
      sessionSend("Log.enable"),
      sessionSend("Fetch.enable", {
        patterns: [{ requestStage: "Request", urlPattern: "*" }],
      }),
      sessionSend("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: policy.viewport.device_scale_factor,
        height: policy.viewport.height,
        mobile: false,
        width: policy.viewport.width,
      }),
    ]);
    const loaded = cdp.waitFor(
      "Page.loadEventFired",
      (_, eventSessionId) => eventSessionId === sessionId,
    );
    controllerNavigationStarted = true;
    const navigation = await sessionSend("Page.navigate", {
      url: policy.target_url,
    });
    mainFrameId = navigation.frameId;
    if (typeof mainFrameId !== "string") {
      throw new Error("browser main frame is unavailable");
    }
    await loaded;
    await gateway.settleEvents();
    gateway.assertHealthy();
    await evidence.record("browser_started", {
      browser: browserIdentity,
      target_url: policy.target_url,
    });
    return {
      async close(status = "closed") {
        await gateway.settleEvents();
        try {
          await gateway.verifyTargetUrl();
        } catch (error) {
          gateway.violation("browser-close", error.message);
        }
        if (stderrOverflow) {
          gateway.violation("browser-stderr-overflow", "stderr exceeded limit");
        }
        try {
          if (browserContextId) {
            await cdp.send("Target.disposeBrowserContext", {
              browserContextId,
            });
          }
        } catch {
          gateway.violation("browser-close", "context disposal failed");
        }
        await gateway.settleEvents();
        const processGroupEmpty =
          await closeBrowserProcessGroup(child, gateway);
        cdp.close();
        const proxyError = await closeProxy();
        if (proxyError !== null) {
          gateway.violation("browser-proxy", proxyError.message);
        }
        try {
          await assertMeasuredFileUnchanged(chrome, "Chrome executable");
        } catch (error) {
          gateway.violation("browser-executable", error.message);
        }
        try {
          const profileRemoved = await removeBrowserProfileIfSafe({
            processGroupEmpty,
            profile,
          });
          if (!profileRemoved) {
            gateway.violation(
              "browser-profile-cleanup",
              "profile retained because process-group cleanup was not proven",
            );
          }
        } catch (error) {
          gateway.violation("browser-profile-cleanup", error.message);
        }
        const finalStatus =
          status === "closed" && gateway.violations.length === 0
            ? "closed"
            : "invalid";
        return evidence.close({
          browser: {
            identity: measuredBrowserIdentity({
              args,
              chrome,
              stderr,
              version,
            }),
            pending_cdp_requests: cdp.pending.size,
          },
          status: finalStatus,
          violations: gateway.violations,
        });
      },
      gateway,
    };
  } catch (error) {
    throw await closeFailedLaunch({ cdp, child, error });
  }
}

function jsonRpcError(id, code, message) {
  return {
    error: { code, message },
    id: id ?? null,
    jsonrpc: "2.0",
  };
}

function jsonRpcResult(id, result) {
  return { id, jsonrpc: "2.0", result };
}

function validatedMcpRequest(value) {
  assertObject(value, "MCP request");
  if (value.jsonrpc !== "2.0") {
    throw new Error("MCP request is invalid");
  }
  assertBoundedString(value.method, "MCP request.method", 128, 1);
  const hasId = Object.hasOwn(value, "id");
  const hasParams = Object.hasOwn(value, "params");
  const expected = [
    ...(hasId ? ["id"] : []),
    "jsonrpc",
    "method",
    ...(hasParams ? ["params"] : []),
  ];
  assertExactKeys(value, expected, "MCP request");
  if (hasParams) assertObject(value.params, "MCP request.params");
  if (hasId) {
    if (typeof value.id === "string") {
      assertBoundedString(value.id, "MCP request.id", 128, 1);
    } else if (!Number.isSafeInteger(value.id)) {
      throw new Error("MCP request.id is invalid");
    }
  }
  return {
    ...value,
    params: hasParams ? value.params : {},
  };
}

function isWellFormedNotification(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.jsonrpc === "2.0" &&
    typeof value.method === "string" &&
    !Object.hasOwn(value, "id")
  );
}

async function writeMcpResponse(output, response) {
  const line = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_MCP_OUTPUT_BYTES) {
    throw new Error("MCP response exceeds its byte limit");
  }
  await new Promise((resolveWrite, rejectWrite) => {
    output.write(line, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

async function handleMcpMessage(message, state, gateway) {
  const request = validatedMcpRequest(message);
  const notification = request.id === undefined;
  if (request.method === "notifications/initialized") {
    if (!notification || !state.initialized) {
      throw new Error("MCP initialized notification is out of order");
    }
    assertExactKeys(request.params, [], "initialized notification.params");
    state.ready = true;
    return null;
  }
  if (notification) {
    throw new Error("unsupported MCP notification");
  }
  if (request.method === "initialize") {
    if (state.initialized) throw new Error("MCP is already initialized");
    assertExactKeys(
      request.params,
      ["capabilities", "clientInfo", "protocolVersion"],
      "initialize.params",
    );
    if (request.params.protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new Error("MCP protocol version is unsupported");
    }
    state.initialized = true;
    return jsonRpcResult(request.id, {
      capabilities: { tools: { listChanged: false } },
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: "qa-suite-browser-gateway",
        version: "1.0.0",
      },
    });
  }
  if (request.method === "ping") {
    if (!state.initialized) {
      throw new Error("MCP ping arrived before initialization");
    }
    assertExactKeys(request.params, [], "ping.params");
    return jsonRpcResult(request.id, {});
  }
  if (!state.ready) throw new Error("MCP request arrived before initialization");
  if (request.method === "tools/list") {
    assertExactKeys(request.params, [], "tools/list.params");
    return jsonRpcResult(request.id, { tools: gateway.listTools() });
  }
  if (request.method === "tools/call") {
    assertExactKeys(
      request.params,
      ["arguments", "name"],
      "tools/call.params",
    );
    assertObject(request.params.arguments, "tools/call.params.arguments");
    assertBoundedString(
      request.params.name,
      "tools/call.params.name",
      64,
      1,
    );
    try {
      const output = await gateway.callTool(
        request.params.name,
        request.params.arguments,
      );
      const content = [{
        text: canonicalJson(output.result),
        type: "text",
      }];
      if (output.image) {
        content.push({
          data: output.image.data,
          mimeType: output.image.mimeType,
          type: "image",
        });
      }
      return jsonRpcResult(request.id, { content, isError: false });
    } catch (error) {
      return jsonRpcResult(request.id, {
        content: [{
          text: boundedText(error.message, 512),
          type: "text",
        }],
        isError: true,
      });
    }
  }
  return jsonRpcError(request.id, -32601, "Method not found");
}

export async function serveBrowserGatewayMcp({
  gateway,
  input = process.stdin,
  output = process.stdout,
}) {
  let buffer = Buffer.alloc(0);
  let messageCount = 0;
  const state = { initialized: false, ready: false };
  for await (const chunk of input) {
    buffer = Buffer.concat([
      buffer,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    if (buffer.length > MAX_MCP_LINE_BYTES && !buffer.includes(0x0a)) {
      throw new Error("MCP request exceeds its line limit");
    }
    let newline = buffer.indexOf(0x0a);
    while (newline !== -1) {
      messageCount += 1;
      if (messageCount > MAX_MCP_MESSAGES) {
        throw new Error("MCP input exceeds its message limit");
      }
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > MAX_MCP_LINE_BYTES) {
        throw new Error("MCP request exceeds its line limit");
      }
      if (line.length > 0) {
        let message;
        let response;
        try {
          message = parseContractJson(line.toString("utf8"), "MCP request");
          response = await handleMcpMessage(message, state, gateway);
        } catch (error) {
          response = isWellFormedNotification(message)
            ? null
            : jsonRpcError(
              Number.isSafeInteger(message?.id) ||
                  typeof message?.id === "string"
                ? message.id
                : null,
              -32600,
              boundedText(error.message, 512),
            );
        }
        if (response !== null) {
          await writeMcpResponse(output, response);
        }
      }
      newline = buffer.indexOf(0x0a);
    }
  }
  if (buffer.length !== 0) {
    throw new Error("MCP input ended with a partial request");
  }
}

export function validateBrowserGatewayClosure(value) {
  assertExactKeys(
    value,
    [
      "browser",
      "journal",
      "policy_sha256",
      "qualification",
      "request_sha256",
      "result",
      "schema_version",
      "source_sha256",
      "status",
      "tools_sha256",
      "verification_status",
      "violations",
    ],
    "browser gateway closure",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null ||
    !["closed", "invalid"].includes(value.status)
  ) {
    throw new Error("browser gateway closure must remain non-qualifying");
  }
  for (const name of [
    "policy_sha256",
    "request_sha256",
    "source_sha256",
    "tools_sha256",
  ]) {
    assertDigest(value[name], `browser gateway closure.${name}`);
  }
  assertExactKeys(
    value.browser,
    [
      "arguments_sha256",
      "executable_sha256",
      "js_version",
      "product",
      "protocol_version",
      "revision",
      "stderr_bytes",
      "stderr_sha256",
      "user_agent",
    ],
    "browser gateway closure.browser",
  );
  for (const name of [
    "arguments_sha256",
    "executable_sha256",
    "stderr_sha256",
  ]) {
    assertDigest(
      value.browser[name],
      `browser gateway closure.browser.${name}`,
    );
  }
  for (const name of [
    "js_version",
    "product",
    "protocol_version",
    "revision",
    "user_agent",
  ]) {
    assertBoundedString(
      value.browser[name],
      `browser gateway closure.browser.${name}`,
      2048,
    );
  }
  assertInteger(
    value.browser.stderr_bytes,
    "browser gateway closure.browser.stderr_bytes",
    0,
    MAX_BROWSER_STDERR_BYTES,
  );
  if (
    value.status === "closed" &&
    [
      value.browser.product,
      value.browser.protocol_version,
      value.browser.revision,
      value.browser.user_agent,
    ].some((field) => field.length === 0)
  ) {
    throw new Error("closed browser gateway identity is incomplete");
  }
  assertExactKeys(
    value.journal,
    ["bytes", "entries", "last_sha256", "path"],
    "browser gateway closure.journal",
  );
  assertInteger(
    value.journal.bytes,
    "browser gateway closure.journal.bytes",
    1,
    MAX_JOURNAL_BYTES,
  );
  assertInteger(
    value.journal.entries,
    "browser gateway closure.journal.entries",
    1,
    4096,
  );
  assertDigest(
    value.journal.last_sha256,
    "browser gateway closure.journal.last_sha256",
  );
  const journalSuffix = "/gateway-journal.jsonl";
  if (
    typeof value.journal.path !== "string" ||
    !value.journal.path.endsWith(journalSuffix)
  ) {
    throw new Error("browser gateway closure.journal.path is invalid");
  }
  validatedEvidencePath(value.journal.path.slice(0, -journalSuffix.length));
  assertDenseArray(value.violations, "browser gateway closure.violations", {
    maximum: 64,
  });
  for (let index = 0; index < value.violations.length; index += 1) {
    const violation = value.violations[index];
    assertExactKeys(
      violation,
      ["detail", "kind"],
      `browser gateway closure.violations[${index}]`,
    );
    if (
      typeof violation.kind !== "string" ||
      !VIOLATION_KIND.test(violation.kind)
    ) {
      throw new Error(
        `browser gateway closure.violations[${index}].kind is invalid`,
      );
    }
    assertBoundedString(
      violation.detail,
      `browser gateway closure.violations[${index}].detail`,
      256,
    );
  }
  if (
    (value.status === "closed" && value.violations.length !== 0) ||
    (value.status === "invalid" && value.violations.length === 0)
  ) {
    throw new Error("browser gateway closure status contradicts violations");
  }
  return value;
}

function parseCanonicalGatewayJson(source, label, maximumBytes) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > maximumBytes
  ) {
    throw new Error(`${label} source is invalid`);
  }
  const value = parseContractJson(source, label);
  if (source !== canonicalJson(value)) {
    throw new Error(`${label} must use canonical JSON`);
  }
  return value;
}

function validateBrowserStarted(payload, closure, policy) {
  assertExactKeys(
    payload,
    ["browser", "target_url"],
    "browser gateway start record",
  );
  const expectedBrowser = { ...closure.browser };
  delete expectedBrowser.stderr_bytes;
  delete expectedBrowser.stderr_sha256;
  if (
    payload.target_url !== policy.target_url ||
    canonicalJson(payload.browser) !== canonicalJson(expectedBrowser)
  ) {
    throw new Error("browser gateway start record does not match closure");
  }
}

function validateBrowserGatewayJournal({
  closure,
  journalSource,
  policy,
}) {
  if (
    typeof journalSource !== "string" ||
    !journalSource.endsWith("\n") ||
    Buffer.byteLength(journalSource, "utf8") !== closure.journal.bytes ||
    closure.journal.bytes > policy.limits.max_journal_bytes
  ) {
    throw new Error("browser gateway journal framing does not match closure");
  }
  const lines = journalSource.slice(0, -1).split("\n");
  assertDenseArray(lines, "browser gateway journal entries", {
    maximum: policy.limits.max_journal_entries,
    minimum: 4,
  });
  if (lines.length !== closure.journal.entries) {
    throw new Error("browser gateway journal entry count does not match closure");
  }
  const terminalBytes = Buffer.byteLength(`${lines.at(-1)}\n`, "utf8");
  if (
    closure.journal.bytes - terminalBytes >
    policy.limits.max_journal_bytes - MAX_JOURNAL_ENTRY_BYTES
  ) {
    throw new Error(
      "browser gateway journal exceeds its reserved nonterminal capacity",
    );
  }

  const entries = [];
  let previous = "0".repeat(64);
  for (let index = 0; index < lines.length; index += 1) {
    if (
      Buffer.byteLength(`${lines[index]}\n`, "utf8") >
      MAX_JOURNAL_ENTRY_BYTES
    ) {
      throw new Error("browser gateway journal entry exceeds its byte limit");
    }
    const entry = parseContractJson(
      lines[index],
      `browser gateway journal entry ${index + 1}`,
    );
    if (canonicalJsonLine(entry) !== `${lines[index]}\n`) {
      throw new Error("browser gateway journal entry is not canonical");
    }
    assertExactKeys(
      entry,
      [
        "entry_sha256",
        "event",
        "payload",
        "previous_sha256",
        "schema_version",
        "sequence",
      ],
      `browser gateway journal entry ${index + 1}`,
    );
    assertBoundedString(
      entry.event,
      `browser gateway journal entry ${index + 1}.event`,
      64,
      1,
    );
    assertObject(
      entry.payload,
      `browser gateway journal entry ${index + 1}.payload`,
    );
    assertDigest(
      entry.entry_sha256,
      `browser gateway journal entry ${index + 1}.entry_sha256`,
    );
    assertDigest(
      entry.previous_sha256,
      `browser gateway journal entry ${index + 1}.previous_sha256`,
    );
    const { entry_sha256, ...unsigned } = entry;
    if (
      entry.schema_version !== 1 ||
      entry.sequence !== index + 1 ||
      entry.previous_sha256 !== previous ||
      entry_sha256 !== sha256(canonicalJson(unsigned))
    ) {
      throw new Error("browser gateway journal hash chain is invalid");
    }
    previous = entry_sha256;
    entries.push(entry);
  }

  if (
    entries[0].event !== "gateway_started" ||
    entries.at(-1).event !== "gateway_closed" ||
    entries.slice(1, -1).some(({ event }) =>
      ["gateway_closed", "gateway_started"].includes(event)
    ) ||
    previous !== closure.journal.last_sha256
  ) {
    throw new Error("browser gateway journal lifecycle does not match closure");
  }
  assertExactKeys(
    entries[0].payload,
    ["policy_sha256", "source_sha256", "tools_sha256"],
    "browser gateway journal start",
  );
  if (
    entries[0].payload.policy_sha256 !== closure.policy_sha256 ||
    entries[0].payload.source_sha256 !== closure.source_sha256 ||
    entries[0].payload.tools_sha256 !== closure.tools_sha256
  ) {
    throw new Error("browser gateway journal start does not match closure");
  }

  const completed = [];
  let browserStarted = 0;
  let proxySummaries = 0;
  let browserStartedSequence = 0;
  let proxySequence = Number.MAX_SAFE_INTEGER;
  for (const entry of entries.slice(1, -1)) {
    if (["browser_console", "page_request"].includes(entry.event)) {
      if (entry.sequence >= proxySequence) {
        throw new Error(`browser gateway ${entry.event} is out of order`);
      }
    } else if (entry.event === "browser_started") {
      browserStarted += 1;
      browserStartedSequence = entry.sequence;
      validateBrowserStarted(entry.payload, closure, policy);
    } else if (entry.event === "tool_completed") {
      assertExactKeys(
        entry.payload,
        ["request_sha256", "result_sha256", "tool"],
        "browser gateway completed tool",
      );
      assertDigest(
        entry.payload.request_sha256,
        "browser gateway completed tool.request_sha256",
      );
      assertDigest(
        entry.payload.result_sha256,
        "browser gateway completed tool.result_sha256",
      );
      assertBoundedString(
        entry.payload.tool,
        "browser gateway completed tool.tool",
        64,
        1,
      );
      completed.push({
        gateway_journal_sequence: entry.sequence,
        ...structuredClone(entry.payload),
      });
    } else if (entry.event === "browser_proxy_summary") {
      proxySummaries += 1;
      proxySequence = entry.sequence;
    } else if (entry.event === "tool_failed") {
      throw new Error("browser gateway journal contains a failed tool call");
    } else if (entry.event === "non_http_request") {
      throw new Error("closed browser gateway journal contains blocked egress");
    } else {
      throw new Error(
        `browser gateway journal event ${entry.event} is unsupported`,
      );
    }
  }
  if (completed.length > policy.limits.max_tool_calls) {
    throw new Error("browser gateway journal exceeds its tool-call limit");
  }
  if (
    browserStarted !== 1 ||
    proxySummaries !== 1 ||
    browserStartedSequence >= proxySequence ||
    completed.some(({ gateway_journal_sequence }) =>
      gateway_journal_sequence <= browserStartedSequence ||
      gateway_journal_sequence >= proxySequence
    )
  ) {
    throw new Error("browser gateway journal runtime order is invalid");
  }

  const terminal = entries.at(-1).payload;
  assertExactKeys(
    terminal,
    ["pending_cdp_requests", "status", "violations"],
    "browser gateway journal close",
  );
  if (
    terminal.pending_cdp_requests !== 0 ||
    terminal.status !== closure.status ||
    canonicalJson(terminal.violations) !== canonicalJson(closure.violations)
  ) {
    throw new Error("browser gateway journal close does not match closure");
  }
  return completed;
}

function decodeCodexGatewayResult(call, policy) {
  validateBrowserToolInvocation(policy, call.tool, call.arguments);
  assertExactKeys(
    call.result,
    ["content", "structured_content"],
    `Codex ${call.tool} gateway result`,
  );
  if (call.result.structured_content !== null) {
    throw new Error(
      `Codex ${call.tool} gateway result.structured_content must be null`,
    );
  }
  const maximumIdResponse = {
    id: "\0".repeat(128),
    jsonrpc: "2.0",
    result: {
      content: call.result.content,
      isError: false,
    },
  };
  if (
    Buffer.byteLength(`${JSON.stringify(maximumIdResponse)}\n`, "utf8") >
    MAX_MCP_OUTPUT_BYTES
  ) {
    throw new Error(`Codex ${call.tool} gateway result exceeds its byte limit`);
  }
  const contentCount = call.tool === "capture_screenshot" ? 2 : 1;
  assertDenseArray(
    call.result.content,
    `Codex ${call.tool} gateway result.content`,
    {
      maximum: contentCount,
      minimum: contentCount,
    },
  );
  const text = call.result.content[0];
  assertExactKeys(
    text,
    ["text", "type"],
    `Codex ${call.tool} gateway text result`,
  );
  if (text.type !== "text" || typeof text.text !== "string") {
    throw new Error(`Codex ${call.tool} gateway text result is invalid`);
  }
  const result = parseContractJson(
    text.text,
    `Codex ${call.tool} gateway text result`,
  );
  assertObject(result, `Codex ${call.tool} gateway text result`);
  if (text.text !== canonicalJson(result)) {
    throw new Error(
      `Codex ${call.tool} gateway text result must use canonical JSON`,
    );
  }

  if (call.tool === "capture_screenshot") {
    const image = call.result.content[1];
    assertExactKeys(
      image,
      ["data", "mimeType", "type"],
      "Codex capture_screenshot image result",
    );
    if (
      image.type !== "image" ||
      image.mimeType !== "image/png" ||
      typeof image.data !== "string"
    ) {
      throw new Error("Codex capture_screenshot image result is invalid");
    }
    const bytes = Buffer.from(image.data, "base64");
    if (
      bytes.length === 0 ||
      bytes.length > policy.limits.max_screenshot_bytes ||
      bytes.toString("base64") !== image.data
    ) {
      throw new Error("Codex capture_screenshot image is invalid");
    }
    assertObject(result.artifact, "Codex capture_screenshot artifact");
    if (
      result.artifact.bytes !== bytes.length ||
      result.artifact.sha256 !== sha256(bytes) ||
      result.mime_type !== image.mimeType
    ) {
      throw new Error(
        "Codex capture_screenshot image does not match its result",
      );
    }
  }
  return result;
}

export function bindCodexBrowserGatewayJournal({
  closureSource,
  codexSource,
  expectedGatewaySourceSha256,
  expectedMcpServer,
  journalSource,
  policySource,
}) {
  assertDigest(
    expectedGatewaySourceSha256,
    "expected browser gateway source SHA-256",
  );
  assertBoundedString(expectedMcpServer, "expected MCP server", 256, 1);
  if (
    expectedMcpServer.trim() !== expectedMcpServer ||
    expectedMcpServer.includes("\0")
  ) {
    throw new Error("expected MCP server is invalid");
  }

  const policy = parseBrowserGatewayPolicy(policySource);
  const closure = parseCanonicalGatewayJson(
    closureSource,
    "browser gateway closure",
    MAX_CLOSURE_BYTES,
  );
  validateBrowserGatewayClosure(closure);
  const expectedToolsSha256 = sha256(
    canonicalJson(browserToolsForPhase(policy.phase)),
  );
  if (
    closure.status !== "closed" ||
    closure.request_sha256 !== policy.request_sha256 ||
    closure.policy_sha256 !== sha256(canonicalJson(policy)) ||
    closure.source_sha256 !== expectedGatewaySourceSha256 ||
    closure.tools_sha256 !== expectedToolsSha256 ||
    closure.browser.executable_sha256 !== policy.chrome.sha256
  ) {
    throw new Error("browser gateway closure is not bound to its authorities");
  }
  if (
    closure.journal.path !==
      `${policy.evidence_path}/gateway-journal.jsonl`
  ) {
    throw new Error("browser gateway journal path is not bound to policy");
  }

  const journalCalls = validateBrowserGatewayJournal({
    closure,
    journalSource,
    policy,
  });
  const turn = parseCodex0145TurnJsonl(codexSource);
  const codexCalls = turn.mcp_calls.map((call) => {
    if (call.server !== expectedMcpServer) {
      throw new Error("Codex MCP call used an unexpected server");
    }
    const result = decodeCodexGatewayResult(call, policy);
    return {
      codex_completed_sequence: call.completed_sequence,
      codex_item_id: call.id,
      codex_started_sequence: call.started_sequence,
      request_sha256: sha256(canonicalJson({
        arguments: call.arguments,
        name: call.tool,
      })),
      result_sha256: sha256(canonicalJson(result)),
      tool: call.tool,
    };
  });
  if (codexCalls.length !== journalCalls.length) {
    throw new Error("Codex calls do not exhaust the gateway journal");
  }
  const calls = codexCalls.map((call, index) => {
    const journalCall = journalCalls[index];
    if (
      call.tool !== journalCall.tool ||
      call.request_sha256 !== journalCall.request_sha256 ||
      call.result_sha256 !== journalCall.result_sha256
    ) {
      throw new Error("Codex calls do not match the gateway journal");
    }
    return {
      ...call,
      gateway_journal_sequence: journalCall.gateway_journal_sequence,
    };
  });

  const binding = {
    calls,
    codex_jsonl_sha256: turn.source_sha256,
    gateway_closure_sha256: sha256(
      Buffer.from(closureSource, "utf8"),
    ),
    gateway_journal_last_sha256: closure.journal.last_sha256,
    gateway_policy_sha256: closure.policy_sha256,
    gateway_source_sha256: closure.source_sha256,
    gateway_tools_sha256: closure.tools_sha256,
    mcp_server: expectedMcpServer,
    phase: policy.phase,
    request_sha256: policy.request_sha256,
    thread_id: turn.thread_id,
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

export async function runBrowserGateway(policySource) {
  const policy = parseBrowserGatewayPolicy(policySource);
  const sourceSha256 = sha256(await readFile(SOURCE_PATH));
  const toolsSha256 = sha256(
    canonicalJson(browserToolsForPhase(policy.phase)),
  );
  const chrome = await measuredRegularFile(
    policy.chrome.path,
    policy.chrome.sha256,
    "Chrome executable",
  );
  const evidenceRoot = await ensureEvidenceRoot(policy);
  const evidence = new EvidenceStore({
    policy,
    root: evidenceRoot,
    sourceSha256,
    toolsSha256,
  });
  await evidence.initialize();
  const browser = await launchBrowser(policy, evidence, chrome);
  let failure = null;
  try {
    await serveBrowserGatewayMcp({ gateway: browser.gateway });
  } catch (error) {
    failure = error;
    browser.gateway.violation("mcp-server", error.message);
  }
  const closure = await browser.close(failure === null ? "closed" : "invalid");
  validateBrowserGatewayClosure(closure);
  if (failure !== null) throw failure;
  if (closure.status !== "closed") {
    throw new Error("browser gateway closed with policy violations");
  }
  return closure;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === BROWSER_SUPERVISOR_MODE) {
    const configSource = process.env[BROWSER_SUPERVISOR_CONFIG];
    delete process.env[BROWSER_SUPERVISOR_CONFIG];
    await runBrowserSupervisor(configSource).catch((error) => {
      process.stderr.write(`Browser supervisor failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  } else {
    const policySource = process.env.QA_SUITE_BROWSER_POLICY;
    delete process.env.QA_SUITE_BROWSER_POLICY;
    await runBrowserGateway(policySource).catch((error) => {
      process.stderr.write(`Browser gateway failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
