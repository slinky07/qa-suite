import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  pathToFileURL,
} from "node:url";
import {
  bindCodexBrowserGatewayJournal,
} from "./browser-gateway.mjs";
import {
  adaptCodexBobPhaseTurn,
} from "./codex-bob-phase-adapter.mjs";
import {
  createCodexHostPolicy,
  codexHostPolicySha256,
} from "./codex-host-policy.mjs";
import {
  canonicalJson,
  isCanonicalBobReportPath,
  parseContractJson,
  sha256,
} from "./contracts.mjs";
import {
  validateBobHostPhaseRequest,
  validateExpectedUseModel,
  validateInterfaceInventory,
  validateTaskExecution,
} from "./bob-host-protocol.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const RUN_ID = /^run_[0-9a-f]{32}$/u;
const DISPATCH_ID = /^dispatch_[0-9a-f]{32}$/u;
const PHASES = new Set([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const SAFE_MODEL = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const FIXED_ENVIRONMENT = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});
const CHATGPT_LOGIN_STATUS = Buffer.from(
  "Logged in using ChatGPT\n",
  "utf8",
);
const PATH_ALIAS_WARNING = Buffer.from(
  "WARNING: proceeding, even though we could not create PATH aliases: " +
    "Operation not permitted (os error 1)\n",
  "utf8",
);
const CHATGPT_LOGIN_STDERR_VARIANTS = Object.freeze([
  CHATGPT_LOGIN_STATUS,
  Buffer.concat([PATH_ALIAS_WARNING, CHATGPT_LOGIN_STATUS]),
]);
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_CODEX_JSONL_BYTES = 16 * 1024 * 1024;
const MAX_CODEX_STDERR_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_PROMPT_INPUT_BYTES = 1024 * 1024;
const MAX_PHASE_PROMPT_BYTES = 128 * 1024;
const CHILD_TIMEOUT_MS = 180_000;
const DIAGNOSTIC_TIMEOUT_MS = 15_000;
const FIXTURE_START_TIMEOUT_MS = 5_000;
const FIXTURE_STOP_TIMEOUT_MS = 2_000;
const GATEWAY_CLOSE_ATTEMPTS = 200;
const GATEWAY_CLOSE_POLL_MS = 25;

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
      throw new Error(`${label} must be dense`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    throw new Error(`${label} must not contain named properties`);
  }
  return value;
}

function assertString(
  value,
  label,
  { maximum = 4096, pattern } = {},
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maximum ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertDigest(value, label) {
  return assertString(value, label, { maximum: 64, pattern: SHA256 });
}

function assertAbsolutePath(value, label) {
  assertString(value, label);
  if (!isAbsolute(value) || resolve(value) !== value) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function assertDescendant(parent, child, label) {
  const selected = relative(parent, child);
  if (
    selected === "" ||
    selected === ".." ||
    selected.startsWith(`..${sep}`) ||
    isAbsolute(selected)
  ) {
    throw new Error(`${label} must be below the lane root`);
  }
}

function measuredIdentity(value, label, { version = false } = {}) {
  assertExactKeys(
    value,
    version ? ["path", "sha256", "version"] : ["path", "sha256"],
    label,
  );
  if (version && value.version !== "codex-cli 0.145.0") {
    throw new Error(`${label}.version must equal codex-cli 0.145.0`);
  }
  return {
    path: assertAbsolutePath(value.path, `${label}.path`),
    sha256: assertDigest(value.sha256, `${label}.sha256`),
    ...(version ? { version: value.version } : {}),
  };
}

function validateTargetPath(value) {
  assertString(value, "phase target config.target_path", { maximum: 2048 });
  const url = new URL(value, "http://127.0.0.1");
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    url.pathname !== value ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("phase target config.target_path is invalid");
  }
  return value;
}

function validateAllowedPaths(value, targetPath) {
  const paths = assertDenseArray(
    value,
    "phase target config.allowed_paths",
    { maximum: 64, minimum: 1 },
  ).map((path, index) =>
    validateTargetPath(
      assertString(
        path,
        `phase target config.allowed_paths[${index}]`,
        { maximum: 2048 },
      ),
    )
  );
  if (
    new Set(paths).size !== paths.length ||
    canonicalJson(paths) !== canonicalJson([...paths].sort()) ||
    !paths.includes(targetPath)
  ) {
    throw new Error(
      "phase target config.allowed_paths must be sorted, unique, and include target_path",
    );
  }
  return paths;
}

function validateConfig(value) {
  assertExactKeys(
    value,
    [
      "allowed_paths",
      "expected_bob_binding",
      "fixture_assets",
      "identities",
      "lane_root",
      "model",
      "output_schemas",
      "prompt_inputs",
      "reasoning_effort",
      "report_path",
      "target_path",
    ],
    "phase target config",
  );
  const laneRoot = assertAbsolutePath(
    value.lane_root,
    "phase target config.lane_root",
  );
  assertExactKeys(
    value.identities,
    ["chrome", "codex", "fixture_server", "gateway", "node"],
    "phase target config.identities",
  );
  const targetPath = validateTargetPath(value.target_path);
  const fixtureServer = measuredIdentity(
    value.identities.fixture_server,
    "phase target config.identities.fixture_server",
  );
  assertDescendant(
    laneRoot,
    fixtureServer.path,
    "phase target config.identities.fixture_server.path",
  );
  const fixtureAssets = assertDenseArray(
    value.fixture_assets,
    "phase target config.fixture_assets",
    { maximum: 16, minimum: 1 },
  ).map((asset, index) => {
    const identity = measuredIdentity(
      asset,
      `phase target config.fixture_assets[${index}]`,
    );
    assertDescendant(
      laneRoot,
      identity.path,
      `phase target config.fixture_assets[${index}].path`,
    );
    return identity;
  });
  const fixtureAssetPaths = fixtureAssets.map(({ path }) => path);
  if (
    new Set(fixtureAssetPaths).size !== fixtureAssetPaths.length ||
    fixtureAssetPaths.includes(fixtureServer.path) ||
    canonicalJson(fixtureAssetPaths) !==
      canonicalJson([...fixtureAssetPaths].sort())
  ) {
    throw new Error(
      "phase target config.fixture_assets must be sorted, unique, and exclude the fixture server",
    );
  }
  assertExactKeys(
    value.output_schemas,
    [...PHASES],
    "phase target config.output_schemas",
  );
  const outputSchemas = Object.fromEntries(
    [...PHASES].map((phase) => [
      phase,
      measuredIdentity(
        value.output_schemas[phase],
        `phase target config.output_schemas.${phase}`,
      ),
    ]),
  );
  const promptInputs = assertDenseArray(
    value.prompt_inputs,
    "phase target config.prompt_inputs",
    { maximum: 16, minimum: 1 },
  ).map((input, index) => {
    const identity = measuredIdentity(
      input,
      `phase target config.prompt_inputs[${index}]`,
    );
    assertDescendant(
      laneRoot,
      identity.path,
      `phase target config.prompt_inputs[${index}].path`,
    );
    return identity;
  });
  if (new Set(promptInputs.map(({ path }) => path)).size !== promptInputs.length) {
    throw new Error("phase target config.prompt_inputs paths must be unique");
  }
  if (!isCanonicalBobReportPath(value.report_path)) {
    throw new Error("phase target config.report_path is invalid");
  }
  assertObject(
    value.expected_bob_binding,
    "phase target config.expected_bob_binding",
  );
  if (!REASONING_EFFORTS.has(value.reasoning_effort)) {
    throw new Error("phase target config.reasoning_effort is invalid");
  }
  return {
    allowed_paths: validateAllowedPaths(value.allowed_paths, targetPath),
    expected_bob_binding: structuredClone(value.expected_bob_binding),
    fixture_assets: fixtureAssets,
    identities: {
      chrome: measuredIdentity(
        value.identities.chrome,
        "phase target config.identities.chrome",
      ),
      codex: measuredIdentity(
        value.identities.codex,
        "phase target config.identities.codex",
        { version: true },
      ),
      fixture_server: fixtureServer,
      gateway: measuredIdentity(
        value.identities.gateway,
        "phase target config.identities.gateway",
      ),
      node: measuredIdentity(
        value.identities.node,
        "phase target config.identities.node",
      ),
    },
    lane_root: laneRoot,
    model: assertString(value.model, "phase target config.model", {
      maximum: 128,
      pattern: SAFE_MODEL,
    }),
    output_schemas: outputSchemas,
    prompt_inputs: promptInputs,
    reasoning_effort: value.reasoning_effort,
    report_path: value.report_path,
    target_path: targetPath,
  };
}

function parseCanonicalSource(source, maximumBytes, label) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > maximumBytes
  ) {
    throw new Error(`${label} is invalid`);
  }
  const value = parseContractJson(source, label);
  if (source !== canonicalJson(value)) {
    throw new Error(`${label} must use canonical JSON`);
  }
  return value;
}

export function parseCodexBobPhaseTargetConfig(source) {
  return validateConfig(
    parseCanonicalSource(source, MAX_CONFIG_BYTES, "phase target config"),
  );
}

export function codexBobPhaseEvidencePath(laneRoot, request) {
  const root = assertAbsolutePath(laneRoot, "lane root");
  assertObject(request, "Bob host phase request");
  assertObject(request.binding, "Bob host phase request.binding");
  const runId = assertString(
    request.binding.run_id,
    "Bob host phase request.binding.run_id",
    { pattern: RUN_ID },
  );
  const dispatchId = assertString(
    request.binding.dispatch_id,
    "Bob host phase request.binding.dispatch_id",
    { pattern: DISPATCH_ID },
  );
  if (!PHASES.has(request.phase)) {
    throw new Error("Bob host phase request.phase is invalid");
  }
  const relativePath = `QA/evidence/${runId}/${dispatchId}/${request.phase}`;
  const absolutePath = resolve(root, relativePath);
  assertDescendant(root, absolutePath, "phase evidence path");
  return {
    absolute_path: absolutePath,
    relative_path: relativePath,
  };
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectMeasuredFile(identity, label, maximum = MAX_FILE_BYTES) {
  const resolved = await realpath(identity.path);
  const metadata = await lstat(identity.path);
  if (
    resolved !== identity.path ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > maximum ||
    (metadata.mode & 0o022) !== 0 ||
    await fileSha256(resolved) !== identity.sha256
  ) {
    throw new Error(`${label} does not match its measured regular file`);
  }
  return identity;
}

async function createEvidenceRoot({ absolute_path: absolute, relative_path: rel }, laneRoot) {
  let current = laneRoot;
  const segments = rel.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const final = index === segments.length - 1;
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (final || error?.code !== "EEXIST") throw error;
    }
    const resolved = await realpath(current);
    const metadata = await lstat(current);
    if (
      resolved !== current ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    ) {
      throw new Error("phase evidence path contains an unsafe directory");
    }
  }
  if (current !== absolute) {
    throw new Error("phase evidence path does not match its authority");
  }
}

async function writeExclusive(path, bytes) {
  await writeFile(path, bytes, { flag: "wx", mode: 0o400 });
}

function collect(stream, maximum, label, onLimit) {
  const chunks = [];
  let bytes = 0;
  stream.on("data", (chunk) => {
    const selected = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += selected.length;
    if (bytes > maximum) {
      onLimit(new Error(`${label} exceeded its byte limit`));
      return;
    }
    chunks.push(selected);
  });
  return () => Buffer.concat(chunks, Math.min(bytes, maximum));
}

async function runCaptured({
  arguments: arguments_,
  command,
  cwd,
  input = null,
  label,
  stderrMaximum,
  stdoutMaximum,
  timeoutMs,
}) {
  let child;
  let failure = null;
  const fail = (error) => {
    failure ??= error;
    child?.kill("SIGKILL");
  };
  child = spawn(command, arguments_, {
    cwd,
    env: { ...FIXED_ENVIRONMENT },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = collect(child.stdout, stdoutMaximum, `${label} stdout`, fail);
  const stderr = collect(child.stderr, stderrMaximum, `${label} stderr`, fail);
  child.once("error", () => fail(new Error(`${label} could not be launched`)));
  const timeout = setTimeout(
    () => fail(new Error(`${label} timed out`)),
    timeoutMs,
  );
  child.stdin.once("error", () => fail(new Error(`${label} rejected stdin`)));
  child.stdin.end(input);
  const [code, signal] = await new Promise((resolveClose) => {
    child.once("close", (exitCode, exitSignal) =>
      resolveClose([exitCode, exitSignal])
    );
  });
  clearTimeout(timeout);
  if (failure !== null) throw failure;
  return {
    code,
    signal,
    stderr: stderr(),
    stdout: stdout(),
  };
}

function boundedObservation(result, observation) {
  return {
    arguments_sha256: observation.arguments_sha256,
    exit_code: result.code,
    observation: observation.label,
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    stderr: {
      bytes: result.stderr.length,
      sha256: sha256(result.stderr),
    },
    stdout: {
      bytes: result.stdout.length,
      sha256: sha256(result.stdout),
    },
    verification_status: "unverified",
    ...observation.fields,
  };
}

async function observeAuthentication(config) {
  const arguments_ = ["login", "status"];
  const result = await runCaptured({
    arguments: arguments_,
    command: config.identities.codex.path,
    cwd: config.lane_root,
    label: "Codex login-status observation",
    stderrMaximum: MAX_DIAGNOSTIC_BYTES,
    stdoutMaximum: MAX_DIAGNOSTIC_BYTES,
    timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
  });
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stdout.length !== 0 ||
    !CHATGPT_LOGIN_STDERR_VARIANTS.some((expected) =>
      result.stderr.equals(expected)
    )
  ) {
    throw new Error("Codex client is not observed as logged in using ChatGPT");
  }
  return boundedObservation(result, {
    arguments_sha256: sha256(canonicalJson(arguments_)),
    fields: {
      login_method: "chatgpt",
      provider_attestation: "not-attested",
    },
    label: "controller-observed-client-login-status",
  });
}

async function observePromptInput(config, prompt) {
  const arguments_ = [
    "debug",
    "prompt-input",
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    "project_doc_fallback_filenames=[]",
    "--config",
    'developer_instructions=""',
    prompt,
  ];
  const result = await runCaptured({
    arguments: arguments_,
    command: config.identities.codex.path,
    cwd: config.lane_root,
    label: "Codex prompt-input observation",
    stderrMaximum: MAX_DIAGNOSTIC_BYTES,
    stdoutMaximum: MAX_DIAGNOSTIC_BYTES,
    timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
  });
  if (
    result.code !== 0 ||
    result.signal !== null
  ) {
    throw new Error("Codex prompt-input observation did not complete");
  }
  const messages = parseContractJson(
    result.stdout.toString("utf8"),
    "Codex prompt-input observation",
  );
  assertDenseArray(messages, "Codex prompt-input messages", {
    maximum: 64,
    minimum: 1,
  });
  const roles = messages.map((message, index) => {
    assertExactKeys(
      message,
      [
        "content",
        "internal_chat_message_metadata_passthrough",
        "role",
        "type",
      ],
      `Codex prompt-input messages[${index}]`,
    );
    return assertString(
      message.role,
      `Codex prompt-input messages[${index}].role`,
      { maximum: 32 },
    );
  });
  return boundedObservation(result, {
    arguments_sha256: sha256(canonicalJson(arguments_)),
    fields: {
      message_count: messages.length,
      roles,
    },
    label: "digest-only-diagnostic-not-context-isolation-attestation",
  });
}

async function startFixtureServer(config) {
  let child;
  let failure = null;
  let shuttingDown = false;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let resolvePort;
  let rejectPort;
  const portPromise = new Promise((resolveStart, rejectStart) => {
    resolvePort = resolveStart;
    rejectPort = rejectStart;
  });
  const fail = (error) => {
    failure ??= error;
    rejectPort(error);
    child?.kill("SIGKILL");
  };
  child = spawn(
    config.identities.node.path,
    [config.identities.fixture_server.path, "0"],
    {
      cwd: dirname(config.identities.fixture_server.path),
      env: { ...FIXED_ENVIRONMENT },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > 1024) {
      fail(new Error("fixture server stdout exceeded its byte limit"));
      return;
    }
    const line = stdout.toString("utf8").split("\n")[0];
    if (/^[0-9]+$/u.test(line)) {
      const port = Number(line);
      if (port >= 1 && port <= 65535) resolvePort(port);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = Buffer.concat([stderr, Buffer.from(chunk)]);
    if (stderr.length > 64 * 1024) {
      fail(new Error("fixture server stderr exceeded its byte limit"));
    }
  });
  child.once("error", () => fail(new Error("fixture server could not launch")));
  child.once("exit", (code) => {
    if (!shuttingDown && failure === null) {
      fail(new Error(`fixture server exited before shutdown (${code})`));
    }
  });
  const timeout = setTimeout(
    () => fail(new Error("fixture server startup timed out")),
    FIXTURE_START_TIMEOUT_MS,
  );
  const port = await portPromise;
  clearTimeout(timeout);
  return {
    port,
    async stop() {
      shuttingDown = true;
      const startupFailure = failure;
      if (child.exitCode === null && child.signalCode === null) {
        const closed = new Promise((resolveClose) =>
          child.once("close", resolveClose)
        );
        child.kill("SIGTERM");
        const timedOut = await Promise.race([
          closed.then(() => false),
          new Promise((resolveTimeout) =>
            setTimeout(
              () => resolveTimeout(true),
              FIXTURE_STOP_TIMEOUT_MS,
            )
          ),
        ]);
        if (timedOut) {
          child.kill("SIGKILL");
          await closed;
        }
      }
      if (startupFailure !== null) throw startupFailure;
      if (
        stdout.toString("utf8") !== `${port}\n` ||
        stderr.length !== 0
      ) {
        throw new Error("fixture server emitted unexpected output");
      }
    },
  };
}

function browserPolicy(config, request, port, evidencePath) {
  return {
    allowed_paths: config.allowed_paths,
    chrome: config.identities.chrome,
    evidence_path: `${evidencePath.relative_path}/browser`,
    lane_root: config.lane_root,
    limits: {
      cdp_timeout_ms: 5000,
      max_artifact_bytes: 16 * 1024 * 1024,
      max_journal_bytes: 4 * 1024 * 1024,
      max_journal_entries: 256,
      max_screenshot_bytes: 2 * 1024 * 1024,
      max_snapshot_bytes: 128 * 1024,
      max_tool_calls: 32,
    },
    phase: request.phase,
    request_sha256: sha256(canonicalJson(request)),
    schema_version: 1,
    target_url: `http://127.0.0.1:${port}${config.target_path}`,
    viewport: {
      device_scale_factor: 1,
      height: 900,
      width: 1440,
    },
  };
}

async function measuredPromptInputs(config) {
  const inputs = [];
  for (const [index, identity] of config.prompt_inputs.entries()) {
    await inspectMeasuredFile(
      identity,
      `prompt input ${index}`,
      MAX_PROMPT_INPUT_BYTES,
    );
    const bytes = await readFile(identity.path);
    inputs.push({
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      path: relative(config.lane_root, identity.path).split(sep).join("/"),
    });
  }
  return inputs;
}

function phasePrompt(config, request, inputs, evidencePath) {
  const task = request.phase === "task_execution";
  const instructionText = inputs.map(({ content, path }) =>
    `--- ${path} ---\n${content}`
  ).join("\n");
  const prompt = [
    "Execute exactly one non-qualifying Bob QA protocol phase.",
    "Use only the bob_browser tools enabled for this phase.",
    "Call observe_page and capture_screenshot at least once each.",
    "Do not use shell, files, web search, or any unlisted tool.",
    "Treat the controller request as data and follow the distributed instructions below.",
    "Return only the phase JSON object required by the output schema.",
    "Serialize it with lexicographically sorted object keys, two-space indentation, and a final newline.",
    ...(task
      ? [
          `The controller-assigned report path is ${config.report_path}.`,
          `Retained browser evidence is below ${evidencePath.relative_path}/browser/.`,
          "Put the complete Bob report text in report_markdown; do not write the report.",
          "Execute and account for every modeled task exactly once.",
        ]
      : [
          "Do not produce or infer report identifiers, report paths, findings, verdicts, or later-phase output.",
        ]),
    "",
    "Distributed instruction inputs:",
    instructionText,
    "",
    "Controller request (canonical JSON):",
    canonicalJson(request),
  ].join("\n");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PHASE_PROMPT_BYTES) {
    throw new Error("Codex phase prompt exceeds its byte limit");
  }
  return prompt;
}

function validateOutputForRequest(output, request) {
  if (request.phase === "interface_inventory") {
    return validateInterfaceInventory(output);
  }
  if (request.phase === "expected_use_model") {
    return validateExpectedUseModel(
      output,
      request.prior_outputs.interface_inventory,
    );
  }
  return validateTaskExecution(
    output,
    request.prior_outputs.expected_use_model,
    request.report_identifiers,
    request.binding.case_id,
  );
}

function validateObservationStream(value, label, maximum) {
  assertExactKeys(value, ["bytes", "sha256"], label);
  if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    value.bytes > maximum
  ) {
    throw new Error(`${label}.bytes is invalid`);
  }
  assertDigest(value.sha256, `${label}.sha256`);
  if (
    value.bytes === 0 &&
    value.sha256 !== sha256(Buffer.alloc(0))
  ) {
    throw new Error(`${label}.sha256 does not match empty bytes`);
  }
}

function validateAuthenticationObservation(value) {
  assertExactKeys(
    value,
    [
      "arguments_sha256",
      "exit_code",
      "login_method",
      "observation",
      "provider_attestation",
      "qualification",
      "result",
      "schema_version",
      "stderr",
      "stdout",
      "verification_status",
    ],
    "auth observation",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null ||
    value.exit_code !== 0 ||
    value.login_method !== "chatgpt" ||
    value.provider_attestation !== "not-attested" ||
    value.observation !== "controller-observed-client-login-status"
  ) {
    throw new Error("auth observation must remain fixed and non-qualifying");
  }
  assertDigest(value.arguments_sha256, "auth observation.arguments_sha256");
  validateObservationStream(
    value.stderr,
    "auth observation.stderr",
    MAX_DIAGNOSTIC_BYTES,
  );
  validateObservationStream(
    value.stdout,
    "auth observation.stdout",
    MAX_DIAGNOSTIC_BYTES,
  );
  if (
    value.stdout.bytes !== 0 ||
    value.stdout.sha256 !== sha256(Buffer.alloc(0)) ||
    !CHATGPT_LOGIN_STDERR_VARIANTS.some((expected) =>
      value.stderr.bytes === expected.length &&
      value.stderr.sha256 === sha256(expected)
    )
  ) {
    throw new Error("auth observation streams do not match ChatGPT status");
  }
  return value;
}

function validatePromptInputObservation(value) {
  assertExactKeys(
    value,
    [
      "arguments_sha256",
      "exit_code",
      "message_count",
      "observation",
      "qualification",
      "result",
      "roles",
      "schema_version",
      "stderr",
      "stdout",
      "verification_status",
    ],
    "prompt-input observation",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null ||
    value.exit_code !== 0 ||
    value.observation !==
      "digest-only-diagnostic-not-context-isolation-attestation"
  ) {
    throw new Error(
      "prompt-input observation must remain fixed and non-qualifying",
    );
  }
  assertDigest(
    value.arguments_sha256,
    "prompt-input observation.arguments_sha256",
  );
  validateObservationStream(
    value.stderr,
    "prompt-input observation.stderr",
    MAX_DIAGNOSTIC_BYTES,
  );
  validateObservationStream(
    value.stdout,
    "prompt-input observation.stdout",
    MAX_DIAGNOSTIC_BYTES,
  );
  assertDenseArray(value.roles, "prompt-input observation.roles", {
    maximum: 64,
    minimum: 1,
  });
  value.roles.forEach((role, index) =>
    assertString(role, `prompt-input observation.roles[${index}]`, {
      maximum: 32,
    })
  );
  if (
    value.message_count !== value.roles.length ||
    value.stdout.bytes < 1
  ) {
    throw new Error("prompt-input observation message summary is invalid");
  }
  return value;
}

export function validateCodexBobPhaseRecord(
  value,
  request,
  expectedAuthorities,
) {
  assertExactKeys(
    expectedAuthorities,
    ["atomicRecord", "gatewayBinding"],
    "independently derived phase authorities",
  );
  assertExactKeys(
    expectedAuthorities.atomicRecord,
    ["output", "receipt", "report_candidate"],
    "independently adapted phase record",
  );
  assertObject(
    expectedAuthorities.gatewayBinding,
    "independently bound gateway record",
  );
  assertExactKeys(
    value,
    [
      "atomic_receipt",
      "auth_observation",
      "codex_jsonl",
      "gateway_binding",
      "host_policy_sha256",
      "output",
      "prompt_input_observation",
      "qualification",
      "result",
      "schema_version",
      "verification_status",
    ],
    "Codex Bob phase record",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error("Codex Bob phase record must remain non-qualifying");
  }
  assertExactKeys(
    value.codex_jsonl,
    ["bytes", "path", "sha256"],
    "Codex Bob phase record.codex_jsonl",
  );
  if (
    !Number.isSafeInteger(value.codex_jsonl.bytes) ||
    value.codex_jsonl.bytes < 1 ||
    value.codex_jsonl.bytes > MAX_CODEX_JSONL_BYTES
  ) {
    throw new Error("Codex Bob phase record.codex_jsonl.bytes is invalid");
  }
  assertDigest(
    value.codex_jsonl.sha256,
    "Codex Bob phase record.codex_jsonl.sha256",
  );
  const evidencePath = codexBobPhaseEvidencePath("/", request).relative_path;
  if (value.codex_jsonl.path !== `${evidencePath}/codex-turn.jsonl`) {
    throw new Error("Codex Bob phase record.codex_jsonl.path is invalid");
  }
  assertDigest(
    value.host_policy_sha256,
    "Codex Bob phase record.host_policy_sha256",
  );
  validateAuthenticationObservation(value.auth_observation);
  validatePromptInputObservation(value.prompt_input_observation);
  if (
    canonicalJson(value.gateway_binding) !==
      canonicalJson(expectedAuthorities.gatewayBinding)
  ) {
    throw new Error(
      "gateway binding does not match its independently derived authority",
    );
  }
  if (
    canonicalJson(value.atomic_receipt) !==
      canonicalJson(expectedAuthorities.atomicRecord.receipt) ||
    canonicalJson(value.output) !==
      canonicalJson(expectedAuthorities.atomicRecord.output) ||
    value.codex_jsonl.sha256 !==
      expectedAuthorities.atomicRecord.receipt.binding.codex_jsonl_sha256
  ) {
    throw new Error(
      "atomic phase record does not match its independently adapted authority",
    );
  }
  validateOutputForRequest(value.output, request);
  return value;
}

async function readBounded(path, maximum, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
    throw new Error(`${label} is not a bounded regular file`);
  }
  return readFile(path);
}

async function readPublishedGatewayClosure(path) {
  for (let attempt = 0; attempt < GATEWAY_CLOSE_ATTEMPTS; attempt += 1) {
    try {
      return await readBounded(
        path,
        64 * 1024,
        "browser gateway closure",
      );
    } catch (error) {
      if (
        error?.code !== "ENOENT" ||
        attempt === GATEWAY_CLOSE_ATTEMPTS - 1
      ) {
        throw error;
      }
      await new Promise((resolvePoll) =>
        setTimeout(resolvePoll, GATEWAY_CLOSE_POLL_MS)
      );
    }
  }
}

export async function runCodexBobPhaseTarget({
  configSource,
  requestSource,
}) {
  const config = parseCodexBobPhaseTargetConfig(configSource);
  const request = parseCanonicalSource(
    requestSource,
    MAX_REQUEST_BYTES,
    "Bob host phase request",
  );
  validateBobHostPhaseRequest(request, config.expected_bob_binding);
  if (await realpath(config.lane_root) !== config.lane_root) {
    throw new Error("phase target lane root must not use a symbolic path");
  }
  const evidencePath = codexBobPhaseEvidencePath(config.lane_root, request);
  await createEvidenceRoot(evidencePath, config.lane_root);

  const identities = [
    ["Codex executable", config.identities.codex],
    ["Node executable", config.identities.node],
    ["browser gateway", config.identities.gateway],
    ["Chrome executable", config.identities.chrome],
    ["fixture server", config.identities.fixture_server],
    ...config.fixture_assets.map((identity, index) => [
      `fixture asset ${index}`,
      identity,
    ]),
    ["phase output schema", config.output_schemas[request.phase]],
  ];
  for (const [label, identity] of identities) {
    await inspectMeasuredFile(identity, label);
  }
  const inputs = await measuredPromptInputs(config);
  const prompt = phasePrompt(config, request, inputs, evidencePath);

  const authObservation = await observeAuthentication(config);
  await writeExclusive(
    join(evidencePath.absolute_path, "auth-observation.json"),
    canonicalJson(authObservation),
  );
  const promptInputObservation = await observePromptInput(config, prompt);
  await writeExclusive(
    join(evidencePath.absolute_path, "prompt-input-observation.json"),
    canonicalJson(promptInputObservation),
  );

  const fixture = await startFixtureServer(config);
  let codexResult;
  let policy;
  try {
    const gatewayPolicySource = canonicalJson(
      browserPolicy(config, request, fixture.port, evidencePath),
    );
    policy = createCodexHostPolicy({
      codex: config.identities.codex,
      gateway: config.identities.gateway,
      gatewayPolicySource,
      laneRoot: config.lane_root,
      model: config.model,
      node: config.identities.node,
      outputSchema: config.output_schemas[request.phase],
      phase: request.phase,
      phaseRequestSha256: sha256(canonicalJson(request)),
      reasoningEffort: config.reasoning_effort,
    });
    await writeExclusive(
      join(evidencePath.absolute_path, "host-policy.json"),
      canonicalJson(policy),
    );
    codexResult = await runCaptured({
      arguments: policy.invocation.arguments,
      command: config.identities.codex.path,
      cwd: config.lane_root,
      input: Buffer.from(prompt, "utf8"),
      label: "Codex phase",
      stderrMaximum: MAX_CODEX_STDERR_BYTES,
      stdoutMaximum: MAX_CODEX_JSONL_BYTES,
      timeoutMs: CHILD_TIMEOUT_MS,
    });
    await writeExclusive(
      join(evidencePath.absolute_path, "codex-turn.jsonl"),
      codexResult.stdout,
    );
    await writeExclusive(
      join(evidencePath.absolute_path, "codex-stderr.bin"),
      codexResult.stderr,
    );
    if (
      codexResult.code !== 0 ||
      codexResult.signal !== null
    ) {
      throw new Error("Codex phase did not complete successfully");
    }
  } finally {
    await fixture.stop();
  }

  for (const [label, identity] of identities) {
    await inspectMeasuredFile(identity, `${label} after execution`);
  }
  const browserRoot = join(evidencePath.absolute_path, "browser");
  const closureBytes = await readPublishedGatewayClosure(
    join(browserRoot, "gateway-close.json"),
  );
  const journalBytes = await readBounded(
    join(browserRoot, "gateway-journal.jsonl"),
    4 * 1024 * 1024,
    "browser gateway journal",
  );
  const codexSource = new TextDecoder("utf-8", { fatal: true }).decode(
    codexResult.stdout,
  );
  const gatewayBinding = bindCodexBrowserGatewayJournal({
    closureSource: closureBytes.toString("utf8"),
    codexSource,
    expectedGatewaySourceSha256: config.identities.gateway.sha256,
    expectedMcpServer: "bob_browser",
    journalSource: journalBytes.toString("utf8"),
    policySource: policy.gateway.policy_source,
  });
  const calledTools = new Set(
    gatewayBinding.binding.calls.map(({ tool }) => tool),
  );
  if (
    !calledTools.has("observe_page") ||
    !calledTools.has("capture_screenshot")
  ) {
    throw new Error(
      "Codex phase did not complete its required browser observations",
    );
  }
  await writeExclusive(
    join(evidencePath.absolute_path, "gateway-binding.json"),
    canonicalJson(gatewayBinding),
  );
  const adapted = adaptCodexBobPhaseTurn({
    codexSource,
    expectedBobBinding: config.expected_bob_binding,
    gatewayBinding,
    reportPath:
      request.phase === "task_execution" ? config.report_path : null,
    request,
  });
  const record = validateCodexBobPhaseRecord(
    {
      atomic_receipt: adapted.receipt,
      auth_observation: authObservation,
      codex_jsonl: {
        bytes: codexResult.stdout.length,
        path: `${evidencePath.relative_path}/codex-turn.jsonl`,
        sha256: sha256(codexResult.stdout),
      },
      gateway_binding: gatewayBinding,
      host_policy_sha256: codexHostPolicySha256(policy),
      output: adapted.output,
      prompt_input_observation: promptInputObservation,
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    },
    request,
    {
      atomicRecord: adapted,
      gatewayBinding,
    },
  );
  await writeExclusive(
    join(evidencePath.absolute_path, "atomic-phase-record.json"),
    canonicalJson(record),
  );
  return {
    output: record.output,
    phase: request.phase,
    request_sha256: sha256(canonicalJson(request)),
    schema_version: 1,
  };
}

async function readStdin(maximum) {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum) {
      throw new Error("phase target stdin exceeded its byte limit");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

export async function main(arguments_ = process.argv.slice(2)) {
  if (arguments_.length !== 1) {
    throw new Error("usage: codex-bob-phase-target.mjs <canonical-config-json>");
  }
  const response = await runCodexBobPhaseTarget({
    configSource: arguments_[0],
    requestSource: await readStdin(MAX_REQUEST_BYTES),
  });
  process.stdout.write(canonicalJson(response));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    process.stderr.write(`Codex Bob phase target failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
