import {
  chmod,
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
import { fileURLToPath } from "node:url";
import {
  executePreparedBobHostProgram,
} from "./bob-host-executor.mjs";
import {
  createPreparedBobHostBinding,
} from "./bob-host-protocol.mjs";
import {
  bindCodexBrowserGatewayJournal,
} from "./browser-gateway.mjs";
import {
  adaptCodexBobPhaseTurn,
} from "./codex-bob-phase-adapter.mjs";
import {
  composeCodexBobPhaseRecords,
} from "./codex-bob-phase-composition.mjs";
import {
  codexBobPhaseEvidencePath,
  parseCodexBobPhaseTargetConfig,
  validateCodexBobPhaseRecord,
} from "./codex-bob-phase-target.mjs";
import {
  codexHostPolicySha256,
  validateCodexHostPolicy,
} from "./codex-host-policy.mjs";
import {
  codexSessionChainSha256,
  createCodexSessionChainSigner,
} from "./codex-session-chain.mjs";
import {
  canonicalJson,
  parseContractJson,
  sha256,
} from "./contracts.mjs";

const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_CANONICAL_RECORD_BYTES = 24 * 1024 * 1024;
const MAX_CODEX_JSONL_BYTES = 16 * 1024 * 1024;
const MAX_GATEWAY_JOURNAL_BYTES = 4 * 1024 * 1024;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_OBSERVATION_BYTES = 1024 * 1024;
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
const PHASE_TARGET_PATH = fileURLToPath(
  new URL("./codex-bob-phase-target.mjs", import.meta.url),
);
const BROWSER_GATEWAY_PATH = fileURLToPath(
  new URL("./browser-gateway.mjs", import.meta.url),
);
const SCHEMA_PATHS = Object.freeze({
  expected_use_model: fileURLToPath(
    new URL(
      "./schemas/codex-bob-expected-use-model-v1.schema.json",
      import.meta.url,
    ),
  ),
  interface_inventory: fileURLToPath(
    new URL(
      "./schemas/codex-bob-interface-inventory-v1.schema.json",
      import.meta.url,
    ),
  ),
  task_execution: fileURLToPath(
    new URL(
      "./schemas/codex-bob-task-execution-draft-v1.schema.json",
      import.meta.url,
    ),
  ),
});
const STATIC_SUPPORT_PATHS = Object.freeze([
  fileURLToPath(
    new URL("../../qa-suite/scripts/finding-ledger.mjs", import.meta.url),
  ),
  fileURLToPath(new URL("./bob-host-protocol.mjs", import.meta.url)),
  BROWSER_GATEWAY_PATH,
  fileURLToPath(new URL("./codex-0145-events.mjs", import.meta.url)),
  fileURLToPath(new URL("./codex-bob-phase-adapter.mjs", import.meta.url)),
  fileURLToPath(new URL("./codex-host-policy.mjs", import.meta.url)),
  fileURLToPath(new URL("./contracts.mjs", import.meta.url)),
  PHASE_TARGET_PATH,
  ...Object.values(SCHEMA_PATHS),
]);
const STATIC_SUPPORT_SHA256 = new Map(
  await Promise.all(
    STATIC_SUPPORT_PATHS.map(async (path) => [
      path,
      sha256(await readFile(path)),
    ]),
  ),
);
const NODE_EXECUTABLE_PATH = await realpath(process.execPath);
const NODE_EXECUTABLE_SHA256 = sha256(
  await readFile(NODE_EXECUTABLE_PATH),
);
const LIVE_CLAIMS = Object.freeze({
  authenticated_client_login:
    "controller-bound-chatgpt-status-observation-only",
  controller_state_chain: "ed25519-key-continuity-verified",
  provider_authentication: "not-attested",
  report_semantics: "not-attested",
  sandbox_qualification: "not-attested",
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

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function assertNormalizedAbsolutePath(value, label) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value.includes("\0")
  ) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function pathIsWithin(parent, child) {
  const selected = relative(parent, child);
  return (
    selected !== "" &&
    selected !== ".." &&
    !selected.startsWith(`..${sep}`) &&
    !isAbsolute(selected)
  );
}

function assertCanonicalEqual(observed, expected, label) {
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match its controller authority`);
  }
}

function validateConfidentialValues(value, suite, selectedCaseId) {
  if (!Array.isArray(value)) {
    throw new Error("confidentialValues must be the exact derived set");
  }
  const expected = [
    ...suite.cases.flatMap(({ oracle_commitments: commitments }) =>
      commitments
    ),
    ...suite.cases
      .filter(({ id }) => id !== selectedCaseId)
      .map(({ id }) => id),
  ].sort();
  if (
    new Set(expected).size !== expected.length ||
    Object.keys(value).length !== value.length ||
    canonicalJson(value) !== canonicalJson(expected)
  ) {
    throw new Error(
      "confidentialValues must equal the sorted oracle commitments and non-selected case IDs",
    );
  }
  return expected;
}

function stableMetadata(metadata) {
  return {
    ctime_ms: metadata.ctimeMs,
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    mtime_ms: metadata.mtimeMs,
    links: metadata.nlink,
    size: metadata.size,
  };
}

async function readStableBoundedFile(path, maximumBytes, label) {
  const resolvedPath = assertNormalizedAbsolutePath(path, `${label} path`);
  const before = await lstat(resolvedPath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes ||
    (before.mode & 0o022) !== 0 ||
    await realpath(resolvedPath) !== resolvedPath
  ) {
    throw new Error(`${label} must be a bounded standalone regular file`);
  }
  const bytes = await readFile(resolvedPath);
  const after = await lstat(resolvedPath);
  if (
    bytes.length !== before.size ||
    canonicalJson(stableMetadata(before)) !==
      canonicalJson(stableMetadata(after))
  ) {
    throw new Error(`${label} changed while the controller read it`);
  }
  return bytes;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain UTF-8 text`);
  }
}

async function readCanonicalFile(path, maximumBytes, label) {
  const bytes = await readStableBoundedFile(path, maximumBytes, label);
  const source = decodeUtf8(bytes, label);
  const value = parseContractJson(source, label);
  if (source !== canonicalJson(value)) {
    throw new Error(`${label} must use canonical JSON`);
  }
  return { bytes, source, value };
}

function validateObservationStream(value, label) {
  assertExactKeys(value, ["bytes", "sha256"], label);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error(`${label}.bytes must be a non-negative safe integer`);
  }
  if (value.bytes > MAX_OBSERVATION_BYTES) {
    throw new Error(`${label}.bytes exceeds its observation limit`);
  }
  assertDigest(value.sha256, `${label}.sha256`);
  if (
    value.bytes === 0 &&
    value.sha256 !== sha256(Buffer.alloc(0))
  ) {
    throw new Error(`${label}.sha256 does not match empty bytes`);
  }
}

function validateNonqualifyingObservation(value, label) {
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null ||
    value.exit_code !== 0
  ) {
    throw new Error(`${label} must remain a completed non-qualifying observation`);
  }
  assertDigest(value.arguments_sha256, `${label}.arguments_sha256`);
  validateObservationStream(value.stdout, `${label}.stdout`);
  validateObservationStream(value.stderr, `${label}.stderr`);
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
    "authentication observation",
  );
  validateNonqualifyingObservation(value, "authentication observation");
  if (
    value.login_method !== "chatgpt" ||
    value.provider_attestation !== "not-attested" ||
    value.observation !== "controller-observed-client-login-status"
  ) {
    throw new Error("authentication observation is not the bounded ChatGPT status");
  }
  if (
    value.stdout.bytes !== 0 ||
    value.stdout.sha256 !== sha256(Buffer.alloc(0)) ||
    !CHATGPT_LOGIN_STDERR_VARIANTS.some((expected) =>
      value.stderr.bytes === expected.length &&
      value.stderr.sha256 === sha256(expected)
    )
  ) {
    throw new Error(
      "authentication observation streams do not match ChatGPT status",
    );
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
  validateNonqualifyingObservation(value, "prompt-input observation");
  if (
    value.observation !==
      "digest-only-diagnostic-not-context-isolation-attestation" ||
    !Number.isSafeInteger(value.message_count) ||
    value.message_count < 1 ||
    value.message_count > 64 ||
    !Array.isArray(value.roles) ||
    value.roles.length !== value.message_count ||
    value.roles.some((role) =>
      typeof role !== "string" ||
      role.length < 1 ||
      role.length > 32
    )
  ) {
    throw new Error("prompt-input observation is invalid");
  }
  return value;
}

async function validateProgramTarget(program, configSource, config) {
  assertObject(program, "program");
  if (
    !Array.isArray(program.arguments) ||
    program.arguments.length !== 2 ||
    program.arguments[1] !== configSource
  ) {
    throw new Error(
      "program must invoke one phase target with the exact canonical config",
    );
  }
  const targetPath = assertNormalizedAbsolutePath(
    program.arguments[0],
    "program phase target",
  );
  if (
    targetPath !== PHASE_TARGET_PATH ||
    config.identities.node.path !== NODE_EXECUTABLE_PATH ||
    config.identities.node.sha256 !== NODE_EXECUTABLE_SHA256 ||
    program.executable !== NODE_EXECUTABLE_PATH ||
    program.executable_sha256 !== NODE_EXECUTABLE_SHA256 ||
    !Array.isArray(program.support_files)
  ) {
    throw new Error(
      "program is not bound to the exact measured Node phase-target source",
    );
  }
  if (
    config.identities.gateway.path !== BROWSER_GATEWAY_PATH ||
    config.identities.gateway.sha256 !==
      STATIC_SUPPORT_SHA256.get(BROWSER_GATEWAY_PATH)
  ) {
    throw new Error(
      "phase-target config is not bound to the production browser gateway",
    );
  }
  for (const phase of PHASES) {
    const path = SCHEMA_PATHS[phase];
    if (
      config.output_schemas[phase].path !== path ||
      config.output_schemas[phase].sha256 !== STATIC_SUPPORT_SHA256.get(path)
    ) {
      throw new Error(
        `phase-target config is not bound to the production ${phase} schema`,
      );
    }
  }
  const required = new Map(STATIC_SUPPORT_SHA256);
  for (const identity of [
    config.identities.fixture_server,
    ...config.fixture_assets,
    ...config.prompt_inputs,
  ]) {
    const prior = required.get(identity.path);
    if (prior !== undefined && prior !== identity.sha256) {
      throw new Error("required support-file roles disagree on a digest");
    }
    required.set(identity.path, identity.sha256);
  }
  const declared = new Map();
  program.support_files.forEach((supportFile, index) => {
    assertExactKeys(
      supportFile,
      ["path", "sha256"],
      `program.support_files[${index}]`,
    );
    if (declared.has(supportFile.path)) {
      throw new Error("program.support_files paths must be unique");
    }
    declared.set(supportFile.path, supportFile.sha256);
  });
  if (
    declared.size !== required.size ||
    [...required].some(
      ([path, digest]) => declared.get(path) !== digest,
    )
  ) {
    throw new Error(
      "program.support_files must equal the complete measured phase-target support set",
    );
  }
}

async function createPrivateSessionDirectory({
  controllerStateParent,
  dispatchId,
  laneRoot,
}) {
  const parent = assertNormalizedAbsolutePath(
    controllerStateParent,
    "controllerStateParent",
  );
  const resolvedParent = await realpath(parent);
  const parentMetadata = await lstat(parent);
  if (
    resolvedParent !== parent ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    (parentMetadata.mode & 0o777) !== 0o700 ||
    pathIsWithin(laneRoot, parent) ||
    pathIsWithin(parent, laneRoot) ||
    parent === laneRoot
  ) {
    throw new Error(
      "controllerStateParent must be a private directory separated from the lane",
    );
  }
  const sessionDirectory = join(parent, `codex-live-${dispatchId}`);
  await mkdir(sessionDirectory, { mode: 0o700 });
  await chmod(sessionDirectory, 0o700);
  const metadata = await lstat(sessionDirectory);
  if (
    await realpath(sessionDirectory) !== sessionDirectory ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new Error("controller session directory is not private");
  }
  return sessionDirectory;
}

async function writePrivateExclusive(path, value) {
  const source = canonicalJson(value);
  await writeFile(path, source, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  return {
    bytes: Buffer.byteLength(source, "utf8"),
    path,
    sha256: sha256(source),
  };
}

async function writeReportExclusive(laneRoot, candidate) {
  const reportPath = resolve(laneRoot, candidate.path);
  if (!pathIsWithin(laneRoot, reportPath)) {
    throw new Error("task report path escaped the lane root");
  }
  const reportParent = dirname(reportPath);
  const parentMetadata = await lstat(reportParent);
  if (
    await realpath(reportParent) !== reportParent ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink()
  ) {
    throw new Error("task report parent is unsafe");
  }
  if (
    !Buffer.isBuffer(candidate.bytes) ||
    candidate.bytes.length < 1 ||
    sha256(candidate.bytes) !== candidate.sha256
  ) {
    throw new Error("task report candidate bytes do not match");
  }
  await writeFile(reportPath, candidate.bytes, {
    flag: "wx",
    mode: 0o400,
  });
  await chmod(reportPath, 0o400);
  const retained = await readStableBoundedFile(
    reportPath,
    candidate.bytes.length,
    "retained task report",
  );
  if (
    retained.length !== candidate.bytes.length ||
    sha256(retained) !== candidate.sha256
  ) {
    throw new Error("retained task report does not match its candidate");
  }
  return {
    bytes: candidate.bytes.length,
    path: candidate.path,
    sha256: candidate.sha256,
  };
}

function phaseArtifactPaths(laneRoot, request) {
  const root = codexBobPhaseEvidencePath(laneRoot, request).absolute_path;
  const browser = join(root, "browser");
  return {
    atomicRecord: join(root, "atomic-phase-record.json"),
    authentication: join(root, "auth-observation.json"),
    codexJsonl: join(root, "codex-turn.jsonl"),
    gatewayClosure: join(browser, "gateway-close.json"),
    gatewayJournal: join(browser, "gateway-journal.jsonl"),
    gatewayPolicy: join(browser, "gateway-policy.json"),
    hostPolicy: join(root, "host-policy.json"),
    promptInput: join(root, "prompt-input-observation.json"),
  };
}

async function verifyPhaseArtifacts({
  config,
  expectedBobBinding,
  laneRoot,
  output,
  receipt,
  request,
}) {
  if (
    receipt.owned_process_group !== "proven-empty" ||
    receipt.phase !== request.phase ||
    receipt.request_sha256 !== sha256(canonicalJson(request))
  ) {
    throw new Error("phase observer did not receive an emptied bound process group");
  }
  const paths = phaseArtifactPaths(laneRoot, request);
  const [
    targetRecordFile,
    authFile,
    promptFile,
    hostPolicyFile,
    gatewayPolicyFile,
    gatewayClosureBytes,
    gatewayJournalBytes,
    codexBytes,
  ] = await Promise.all([
    readCanonicalFile(
      paths.atomicRecord,
      MAX_CANONICAL_RECORD_BYTES,
      "target atomic phase record",
    ),
    readCanonicalFile(
      paths.authentication,
      MAX_OBSERVATION_BYTES,
      "authentication observation file",
    ),
    readCanonicalFile(
      paths.promptInput,
      MAX_OBSERVATION_BYTES,
      "prompt-input observation file",
    ),
    readCanonicalFile(
      paths.hostPolicy,
      MAX_POLICY_BYTES,
      "host policy file",
    ),
    readCanonicalFile(
      paths.gatewayPolicy,
      MAX_POLICY_BYTES,
      "gateway policy file",
    ),
    readStableBoundedFile(
      paths.gatewayClosure,
      MAX_POLICY_BYTES,
      "gateway closure file",
    ),
    readStableBoundedFile(
      paths.gatewayJournal,
      MAX_GATEWAY_JOURNAL_BYTES,
      "gateway journal file",
    ),
    readStableBoundedFile(
      paths.codexJsonl,
      MAX_CODEX_JSONL_BYTES,
      "Codex JSONL file",
    ),
  ]);
  const targetRecord = targetRecordFile.value;
  assertObject(targetRecord, "target atomic phase record");
  const authObservation = validateAuthenticationObservation(authFile.value);
  const promptInputObservation = validatePromptInputObservation(promptFile.value);
  assertCanonicalEqual(
    targetRecord.auth_observation,
    authObservation,
    "target authentication observation",
  );
  assertCanonicalEqual(
    targetRecord.prompt_input_observation,
    promptInputObservation,
    "target prompt-input observation",
  );
  const codexSource = decodeUtf8(codexBytes, "Codex JSONL file");
  const hostPolicy = validateCodexHostPolicy(hostPolicyFile.value);
  const hostPolicySha256 = codexHostPolicySha256(hostPolicy);
  if (
    hostPolicy.invocation.lane_root !== laneRoot ||
    hostPolicy.invocation.phase !== request.phase ||
    hostPolicy.invocation.phase_request_sha256 !==
      sha256(canonicalJson(request)) ||
    hostPolicy.identities.codex.path !== config.identities.codex.path ||
    hostPolicy.identities.codex.sha256 !== config.identities.codex.sha256 ||
    hostPolicy.identities.node.path !== config.identities.node.path ||
    hostPolicy.identities.node.sha256 !== config.identities.node.sha256 ||
    hostPolicy.identities.gateway.path !== config.identities.gateway.path ||
    hostPolicy.identities.gateway.sha256 !== config.identities.gateway.sha256
  ) {
    throw new Error("retained host policy does not match the live-session config");
  }
  if (hostPolicy.gateway.policy_source !== gatewayPolicyFile.source) {
    throw new Error("retained gateway policy does not match the host policy");
  }
  const gatewayBinding = bindCodexBrowserGatewayJournal({
    closureSource: decodeUtf8(
      gatewayClosureBytes,
      "gateway closure file",
    ),
    codexSource,
    expectedGatewaySourceSha256: config.identities.gateway.sha256,
    expectedMcpServer: "bob_browser",
    journalSource: decodeUtf8(
      gatewayJournalBytes,
      "gateway journal file",
    ),
    policySource: gatewayPolicyFile.source,
  });
  if (gatewayBinding.binding.calls.length < 1) {
    throw new Error("phase did not retain a browser-gateway call");
  }
  const adapted = adaptCodexBobPhaseTurn({
    codexSource,
    expectedBobBinding,
    gatewayBinding,
    reportPath:
      request.phase === "task_execution" ? config.report_path : null,
    request,
  });
  validateCodexBobPhaseRecord(targetRecord, request, {
    atomicRecord: adapted,
    gatewayBinding,
  });
  if (
    targetRecord.codex_jsonl.bytes !== codexBytes.length ||
    targetRecord.codex_jsonl.sha256 !== sha256(codexBytes)
  ) {
    throw new Error("target Codex JSONL reference does not match retained bytes");
  }
  if (hostPolicySha256 !== targetRecord.host_policy_sha256) {
    throw new Error("retained host policy does not match the target record");
  }
  assertCanonicalEqual(targetRecord.output, adapted.output, "target phase output");
  assertCanonicalEqual(
    targetRecord.atomic_receipt,
    adapted.receipt,
    "target atomic receipt",
  );
  assertCanonicalEqual(output, adapted.output, "executor phase output");
  if (receipt.output_sha256 !== sha256(canonicalJson(adapted.output))) {
    throw new Error("process receipt output digest does not match the phase");
  }
  return {
    adapted,
    authObservation,
    hostPolicySha256,
    promptInputObservation,
    targetRecordSha256: sha256(targetRecordFile.source),
  };
}

function controllerPhaseRecord({
  adapted,
  receipt,
  targetRecordSha256,
  transition,
}) {
  const unsigned = {
    atomic_receipt_sha256: sha256(canonicalJson(adapted.receipt)),
    process_receipt: structuredClone(receipt),
    process_receipt_sha256: sha256(canonicalJson(receipt)),
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    target_record_sha256: targetRecordSha256,
    transition: structuredClone(transition),
    verification_status: "unverified",
  };
  return {
    ...unsigned,
    controller_phase_record_sha256: sha256(canonicalJson(unsigned)),
  };
}

function liveRecord({
  composition,
  execution,
  phaseRecordReferences,
  report,
  sessionChain,
}) {
  const unsigned = {
    claims: structuredClone(LIVE_CLAIMS),
    composition: structuredClone(composition),
    execution: structuredClone(execution),
    phase_records: structuredClone(phaseRecordReferences),
    qualification: "not-evidence",
    report: structuredClone(report),
    result: null,
    schema_version: 1,
    session_chain: structuredClone(sessionChain),
    session_chain_sha256: codexSessionChainSha256(sessionChain),
    verification_status: "unverified",
  };
  return {
    ...unsigned,
    live_record_sha256: sha256(canonicalJson(unsigned)),
  };
}

export async function executeCodexBobLiveSession({
  confidentialValues,
  controllerStateParent,
  dispatchId,
  laneRoot,
  limits = {},
  preparation,
  program,
  suite,
}) {
  const expectedBobBinding = createPreparedBobHostBinding({
    dispatchId,
    preparation,
    suite,
  });
  const selectedConfidentialValues = validateConfidentialValues(
    confidentialValues,
    suite,
    preparation.case_id,
  );
  const selectedLaneRoot = assertNormalizedAbsolutePath(laneRoot, "laneRoot");
  if (
    !Array.isArray(program?.arguments) ||
    typeof program.arguments[1] !== "string"
  ) {
    throw new Error("program must contain a canonical phase-target config");
  }
  const configSource = program.arguments[1];
  const config = parseCodexBobPhaseTargetConfig(configSource);
  assertCanonicalEqual(
    config.expected_bob_binding,
    expectedBobBinding,
    "phase-target Bob binding",
  );
  if (config.lane_root !== selectedLaneRoot) {
    throw new Error("phase-target lane root does not match the controller");
  }
  await validateProgramTarget(program, configSource, config);
  const sessionDirectory = await createPrivateSessionDirectory({
    controllerStateParent,
    dispatchId,
    laneRoot: selectedLaneRoot,
  });
  const signer = createCodexSessionChainSigner();
  const atomicPhaseRecords = [];
  const phaseRecordReferences = [];
  let phaseIndex = 0;

  const execution = await executePreparedBobHostProgram({
    confidentialValues: selectedConfidentialValues,
    dispatchId,
    laneRoot: selectedLaneRoot,
    limits,
    async observePhase({ output, receipt, request }) {
      if (request.phase !== PHASES[phaseIndex]) {
        throw new Error("live controller phase order changed");
      }
      const verified = await verifyPhaseArtifacts({
        config,
        expectedBobBinding,
        laneRoot: selectedLaneRoot,
        output,
        receipt,
        request,
      });
      const transition = signer.appendTransition({
        atomic_receipt_sha256: sha256(
          canonicalJson(verified.adapted.receipt),
        ),
        auth_observation_sha256: sha256(
          canonicalJson(verified.authObservation),
        ),
        codex_jsonl_sha256:
          verified.adapted.receipt.binding.codex_jsonl_sha256,
        gateway_binding_sha256:
          verified.adapted.receipt.binding.gateway_binding_sha256,
        host_policy_sha256: verified.hostPolicySha256,
        output_sha256: verified.adapted.receipt.binding.output_sha256,
        phase: request.phase,
        process_receipt_sha256: sha256(canonicalJson(receipt)),
        prompt_input_sha256: sha256(
          canonicalJson(verified.promptInputObservation),
        ),
        request_sha256: verified.adapted.receipt.binding.request_sha256,
        terminal_status: "completed",
        thread_id: verified.adapted.receipt.binding.thread_id,
      });
      const phaseRecord = controllerPhaseRecord({
        adapted: verified.adapted,
        receipt,
        targetRecordSha256: verified.targetRecordSha256,
        transition,
      });
      const reference = await writePrivateExclusive(
        join(
          sessionDirectory,
          `${String(phaseIndex + 1).padStart(2, "0")}-${request.phase}.json`,
        ),
        phaseRecord,
      );
      atomicPhaseRecords.push(verified.adapted);
      phaseRecordReferences.push({
        controller_phase_record_sha256:
          phaseRecord.controller_phase_record_sha256,
        path: reference.path,
        sha256: reference.sha256,
      });
      phaseIndex += 1;
    },
    preparation,
    program,
    suite,
  });
  if (phaseIndex !== PHASES.length) {
    throw new Error("live controller did not observe all three phases");
  }
  const composed = composeCodexBobPhaseRecords({
    expectedBobBinding,
    phaseRecords: atomicPhaseRecords,
  });
  assertCanonicalEqual(
    composed.transcript,
    execution.transcript,
    "independently composed transcript",
  );
  const sessionChain = signer.close();
  const report = await writeReportExclusive(
    selectedLaneRoot,
    composed.report_candidate,
  );
  const sessionChainReference = await writePrivateExclusive(
    join(sessionDirectory, "session-chain.json"),
    sessionChain,
  );
  const retainedLiveRecord = liveRecord({
    composition: composed.composition,
    execution,
    phaseRecordReferences,
    report,
    sessionChain,
  });
  const liveRecordReference = await writePrivateExclusive(
    join(sessionDirectory, "live-session.json"),
    retainedLiveRecord,
  );
  return {
    composition: composed.composition,
    controller_state_directory: sessionDirectory,
    execution,
    live_record: retainedLiveRecord,
    live_record_path: liveRecordReference.path,
    qualification: "not-evidence",
    report,
    result: null,
    schema_version: 1,
    session_chain: sessionChain,
    session_chain_path: sessionChainReference.path,
    verification_status: "unverified",
  };
}
