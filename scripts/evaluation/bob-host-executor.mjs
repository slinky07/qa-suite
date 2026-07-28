import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
} from "node:path";
import {
  canonicalJson,
  parseContractJson,
  sha256,
} from "./contracts.mjs";
import {
  executePreparedBobCase,
  requestsFromBobHostTranscript,
  validateBobHostTranscript,
} from "./bob-host-protocol.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const CONFIDENTIAL_VALUE = /^(?:fx_[0-9a-f]{32}|seal_[0-9a-f]{64})$/;
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
const MAX_SUPPORT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SUPPORT_FILES = 32;
const MAX_SUPPORT_FILES_BYTES = 64 * 1024 * 1024;
const FIXED_ENVIRONMENT = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});
const DEFAULT_LIMITS = Object.freeze({
  input_bytes: 512 * 1024,
  output_bytes: 1024 * 1024,
  timeout_ms: 5 * 60 * 1000,
});
const LIMIT_CEILINGS = Object.freeze({
  input_bytes: 4 * 1024 * 1024,
  output_bytes: 8 * 1024 * 1024,
  timeout_ms: 15 * 60 * 1000,
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
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function assertBoundedInteger(value, label, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`${label} must be a positive safe integer at most ${maximum}`);
  }
  return value;
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

function normalizedLimits(value = {}) {
  assertObject(value, "limits");
  const unknown = Object.keys(value).filter(
    (key) => !Object.hasOwn(DEFAULT_LIMITS, key),
  );
  if (unknown.length > 0) {
    throw new Error(`limits contains unsupported fields: ${unknown.join(", ")}`);
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([name, defaultValue]) => [
      name,
      assertBoundedInteger(
        value[name] ?? defaultValue,
        `limits.${name}`,
        LIMIT_CEILINGS[name],
      ),
    ]),
  );
}

function normalizedArguments(value) {
  return assertDenseArray(value, "program.arguments", {
    maximum: 64,
  }).map((argument, index) => {
    if (
      typeof argument !== "string" ||
      argument.length > 16 * 1024 ||
      argument.includes("\0")
    ) {
      throw new Error(`program.arguments[${index}] is invalid`);
    }
    return argument;
  });
}

function normalizedConfidentialValues(value = []) {
  const values = assertDenseArray(value, "confidentialValues", {
    maximum: 4096,
  });
  const caseTokens = new Set();
  const sealedTokens = new Set();
  values.forEach((item, index) => {
    if (
      typeof item !== "string" ||
      !CONFIDENTIAL_VALUE.test(item)
    ) {
      throw new Error(
        `confidentialValues[${index}] must be an opaque evaluation token`,
      );
    }
    (item.startsWith("fx_") ? caseTokens : sealedTokens).add(item);
  });
  return { caseTokens, sealedTokens };
}

function containsTokenAt(bytes, offset, byteLength, tokens) {
  return (
    offset + byteLength <= bytes.length &&
    tokens.has(bytes.toString("ascii", offset, offset + byteLength))
  );
}

function containsConfidentialValue(bytes, confidentialValues) {
  const { caseTokens, sealedTokens } = confidentialValues;
  if (caseTokens.size === 0 && sealedTokens.size === 0) {
    return false;
  }
  for (let offset = 0; offset + 3 <= bytes.length; offset += 1) {
    if (
      bytes[offset] === 0x66 &&
      bytes[offset + 1] === 0x78 &&
      bytes[offset + 2] === 0x5f &&
      containsTokenAt(bytes, offset, 35, caseTokens)
    ) {
      return true;
    }
    if (
      bytes[offset] === 0x73 &&
      bytes[offset + 1] === 0x65 &&
      bytes[offset + 2] === 0x61 &&
      bytes[offset + 3] === 0x6c &&
      bytes[offset + 4] === 0x5f &&
      containsTokenAt(bytes, offset, 69, sealedTokens)
    ) {
      return true;
    }
  }
  return false;
}

function fileIdentity(metadata) {
  return {
    ctime_ms: metadata.ctimeMs,
    device: metadata.dev,
    inode: metadata.ino,
    links: metadata.nlink,
    mode: metadata.mode,
    mtime_ms: metadata.mtimeMs,
    size: metadata.size,
  };
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function inspectRegularProgramFile({
  confidentialValues,
  digestLabel,
  expectedSha256,
  label,
  maximumBytes,
  mismatchTarget,
  path,
  pathLabel,
  requireExecutable,
}) {
  if (
    typeof path !== "string" ||
    path.includes("\0") ||
    !isAbsolute(path)
  ) {
    throw new Error(`${pathLabel} must be absolute`);
  }
  if (
    containsConfidentialValue(Buffer.from(path, "utf8"), confidentialValues)
  ) {
    throw new Error(`${label} path contains controller-confidential data`);
  }
  assertDigest(expectedSha256, digestLabel);
  const resolved = await realpath(path);
  if (resolved !== path) {
    throw new Error(`${pathLabel} must not use a symbolic path`);
  }
  const metadata = await lstat(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size > maximumBytes ||
    (requireExecutable && (metadata.mode & 0o111) === 0) ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error(
      `${pathLabel} must be a bounded, standalone, ${
        requireExecutable ? "executable, " : ""
      }regular file that is not group- or world-writable`,
    );
  }
  const bytes = await readFile(resolved);
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(`${digestLabel} does not match ${mismatchTarget}`);
  }
  if (containsConfidentialValue(bytes, confidentialValues)) {
    throw new Error(`${label} contains controller-confidential data`);
  }
  return {
    identity: fileIdentity(metadata),
    path: resolved,
    sha256: expectedSha256,
    size: metadata.size,
  };
}

async function inspectSupportFiles(value, confidentialValues, executable) {
  const declarations = assertDenseArray(value, "program.support_files", {
    maximum: MAX_SUPPORT_FILES,
  });
  const supportFiles = [];
  let totalBytes = 0;
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index];
    const label = `program.support_files[${index}]`;
    assertExactKeys(declaration, ["path", "sha256"], label);
    const supportFile = await inspectRegularProgramFile({
      confidentialValues,
      digestLabel: `${label}.sha256`,
      expectedSha256: declaration.sha256,
      label,
      maximumBytes: MAX_SUPPORT_FILE_BYTES,
      mismatchTarget: `${label}.path`,
      path: declaration.path,
      pathLabel: `${label}.path`,
      requireExecutable: false,
    });
    if (
      supportFile.path === executable ||
      supportFiles.some(({ path }) => path === supportFile.path)
    ) {
      throw new Error("program file paths must be unique");
    }
    totalBytes += supportFile.size;
    if (totalBytes > MAX_SUPPORT_FILES_BYTES) {
      throw new Error("program.support_files exceeds its total byte limit");
    }
    supportFiles.push(supportFile);
  }
  return supportFiles;
}

async function inspectProgram(program, confidentialValues) {
  assertExactKeys(
    program,
    ["arguments", "executable", "executable_sha256", "support_files"],
    "program",
  );
  const executable = await inspectRegularProgramFile({
    confidentialValues,
    digestLabel: "program.executable_sha256",
    expectedSha256: program.executable_sha256,
    label: "program executable",
    maximumBytes: MAX_EXECUTABLE_BYTES,
    mismatchTarget: "the executable",
    path: program.executable,
    pathLabel: "program.executable",
    requireExecutable: true,
  });
  const supportFiles = await inspectSupportFiles(
    program.support_files,
    confidentialValues,
    executable.path,
  );
  return {
    arguments: normalizedArguments(program.arguments),
    executable: executable.path,
    executable_sha256: program.executable_sha256,
    identity: executable.identity,
    support_files: supportFiles,
  };
}

async function assertProgramUnchanged(program) {
  const executable = await realpath(program.executable);
  const metadata = await lstat(executable);
  if (
    executable !== program.executable ||
    !sameIdentity(fileIdentity(metadata), program.identity)
  ) {
    throw new Error("host program changed during execution");
  }
  for (const supportFile of program.support_files) {
    const resolvedSupportFile = await realpath(supportFile.path);
    const supportMetadata = await lstat(resolvedSupportFile);
    if (
      resolvedSupportFile !== supportFile.path ||
      !sameIdentity(fileIdentity(supportMetadata), supportFile.identity)
    ) {
      throw new Error("host program support file changed during execution");
    }
    const bytes = await readFile(resolvedSupportFile);
    if (sha256(bytes) !== supportFile.sha256) {
      throw new Error("host program support file changed during execution");
    }
  }
}

async function inspectLaneRoot(laneRoot, preparation) {
  if (!isAbsolute(laneRoot)) {
    throw new Error("laneRoot must be absolute");
  }
  const resolved = await realpath(laneRoot);
  const metadata = await lstat(resolved);
  if (
    resolved !== laneRoot ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o555 ||
    basename(resolved) !== preparation.run_id
  ) {
    throw new Error("laneRoot must be the sealed root for preparation.run_id");
  }
  return {
    identity: fileIdentity(metadata),
    path: resolved,
  };
}

async function assertLaneRootUnchanged(laneRoot) {
  const resolved = await realpath(laneRoot.path);
  const metadata = await lstat(resolved);
  if (
    resolved !== laneRoot.path ||
    !sameIdentity(fileIdentity(metadata), laneRoot.identity)
  ) {
    throw new Error("laneRoot changed during execution");
  }
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

function validateResponse(bytes, request, requestDigest) {
  const source = decodeUtf8(bytes, "host response");
  const response = parseContractJson(source, "host response");
  if (source !== canonicalJson(response)) {
    throw new Error("host response must use canonical JSON");
  }
  assertExactKeys(
    response,
    ["output", "phase", "request_sha256", "schema_version"],
    "host response",
  );
  if (
    response.schema_version !== 1 ||
    response.phase !== request.phase ||
    response.request_sha256 !== requestDigest
  ) {
    throw new Error("host response is not bound to its request");
  }
  assertObject(response.output, "host response.output");
  return response;
}

async function invokeProgram({
  confidentialValues,
  laneRoot,
  limits,
  program,
  request,
}) {
  const input = Buffer.from(canonicalJson(request), "utf8");
  if (input.length > limits.input_bytes) {
    throw new Error("host request exceeds limits.input_bytes");
  }
  if (
    containsConfidentialValue(input, confidentialValues) ||
    program.arguments.some((argument) =>
      containsConfidentialValue(Buffer.from(argument, "utf8"), confidentialValues),
    )
  ) {
    throw new Error("controller-confidential data reached the host launch");
  }
  const requestDigest = sha256(input);

  const result = await new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let deadline;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      action();
    };
    const rejectProcess = (message) => {
      child?.kill?.("SIGKILL");
      child?.stdin?.destroy?.();
      child?.stdout?.destroy?.();
      child?.stderr?.destroy?.();
      settle(() => reject(new Error(message)));
    };
    try {
      child = execFile(
        program.executable,
        program.arguments,
        {
          cwd: laneRoot.path,
          encoding: null,
          env: { ...FIXED_ENVIRONMENT },
          killSignal: "SIGKILL",
          maxBuffer: limits.output_bytes,
          shell: false,
          timeout: limits.timeout_ms,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            rejectProcess("Bob host process did not complete successfully");
            return;
          }
          settle(() =>
            resolve({
              stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
              stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
            }),
          );
        },
      );
    } catch {
      rejectProcess("Bob host process could not be launched");
      return;
    }
    if (
      child === null ||
      typeof child !== "object" ||
      child.stdin === null ||
      typeof child.stdin?.end !== "function"
    ) {
      rejectProcess("Bob host launcher returned an invalid child");
      return;
    }
    child.stdin.once("error", () => {
      rejectProcess("Bob host process rejected its request");
    });
    deadline = setTimeout(
      () => rejectProcess("Bob host process exceeded its controller deadline"),
      limits.timeout_ms,
    );
    child.stdin.end(input);
  });

  await assertProgramUnchanged(program);
  await assertLaneRootUnchanged(laneRoot);
  if (
    containsConfidentialValue(result.stdout, confidentialValues) ||
    containsConfidentialValue(result.stderr, confidentialValues)
  ) {
    throw new Error("Bob host process emitted controller-confidential data");
  }
  const response = validateResponse(result.stdout, request, requestDigest);
  return {
    output: response.output,
    receipt: {
      output_sha256: sha256(canonicalJson(response.output)),
      phase: request.phase,
      request_sha256: requestDigest,
      response_bytes: result.stdout.length,
      response_sha256: sha256(result.stdout),
      stderr_bytes: result.stderr.length,
      stderr_sha256: sha256(result.stderr),
    },
  };
}

function executionDigest(value) {
  const unsigned = { ...value };
  delete unsigned.execution_sha256;
  return sha256(canonicalJson(unsigned));
}

export function validateBobHostExecution(value) {
  assertExactKeys(
    value,
    [
      "execution_observation",
      "execution_sha256",
      "policy_sha256",
      "process_receipts",
      "program",
      "qualification",
      "result",
      "schema_version",
      "transcript",
      "verification_status",
    ],
    "Bob host execution",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null ||
    value.execution_observation !== "three-direct-processes-completed"
  ) {
    throw new Error("Bob host execution must remain explicitly non-qualifying");
  }
  assertDigest(value.execution_sha256, "Bob host execution.execution_sha256");
  assertDigest(value.policy_sha256, "Bob host execution.policy_sha256");
  assertExactKeys(
    value.program,
    [
      "arguments_sha256",
      "executable_sha256",
      "support_files_sha256",
    ],
    "Bob host execution.program",
  );
  assertDigest(
    value.program.arguments_sha256,
    "Bob host execution.program.arguments_sha256",
  );
  assertDigest(
    value.program.executable_sha256,
    "Bob host execution.program.executable_sha256",
  );
  assertDigest(
    value.program.support_files_sha256,
    "Bob host execution.program.support_files_sha256",
  );
  const transcript = validateBobHostTranscript(value.transcript);
  const requests = requestsFromBobHostTranscript(transcript);
  assertDenseArray(value.process_receipts, "Bob host execution.process_receipts", {
    maximum: requests.length,
    minimum: requests.length,
  });
  value.process_receipts.forEach((receipt, index) => {
    assertExactKeys(
      receipt,
      [
        "output_sha256",
        "phase",
        "request_sha256",
        "response_bytes",
        "response_sha256",
        "stderr_bytes",
        "stderr_sha256",
      ],
      `Bob host execution.process_receipts[${index}]`,
    );
    for (const name of [
      "output_sha256",
      "request_sha256",
      "response_sha256",
      "stderr_sha256",
    ]) {
      assertDigest(
        receipt[name],
        `Bob host execution.process_receipts[${index}].${name}`,
      );
    }
    for (const name of ["response_bytes", "stderr_bytes"]) {
      if (!Number.isSafeInteger(receipt[name]) || receipt[name] < 0) {
        throw new Error(
          `Bob host execution.process_receipts[${index}].${name} is invalid`,
        );
      }
    }
    const expectedRequestDigest = sha256(canonicalJson(requests[index]));
    const expectedResponse = Buffer.from(
      canonicalJson({
        output: transcript.outputs[requests[index].phase],
        phase: requests[index].phase,
        request_sha256: expectedRequestDigest,
        schema_version: 1,
      }),
      "utf8",
    );
    if (
      receipt.phase !== requests[index].phase ||
      receipt.request_sha256 !== expectedRequestDigest ||
      receipt.output_sha256 !== transcript.events[index].output_sha256 ||
      receipt.response_bytes !== expectedResponse.length ||
      receipt.response_sha256 !== sha256(expectedResponse)
    ) {
      throw new Error("Bob host process receipt is not bound to the transcript");
    }
  });
  if (executionDigest(value) !== value.execution_sha256) {
    throw new Error("Bob host execution.execution_sha256 does not match");
  }
  return value;
}

export async function executePreparedBobHostProgram({
  confidentialValues = [],
  laneRoot,
  limits = {},
  preparation,
  program,
  suite,
}) {
  assertObject(preparation, "preparation");
  const selectedLimits = normalizedLimits(limits);
  const selectedConfidentialValues =
    normalizedConfidentialValues(confidentialValues);
  const selectedProgram = await inspectProgram(
    program,
    selectedConfidentialValues,
  );
  const selectedLaneRoot = await inspectLaneRoot(laneRoot, preparation);
  const processReceipts = [];
  const adapter = {
    async runPhase(request) {
      const { output, receipt } = await invokeProgram({
        confidentialValues: selectedConfidentialValues,
        laneRoot: selectedLaneRoot,
        limits: selectedLimits,
        program: selectedProgram,
        request,
      });
      processReceipts.push(receipt);
      return output;
    },
  };
  const transcript = await executePreparedBobCase({
    adapter,
    preparation,
    suite,
  });
  const policy = {
    child_environment: FIXED_ENVIRONMENT,
    cwd_sha256: sha256(Buffer.from(selectedLaneRoot.path, "utf8")),
    limits: selectedLimits,
    shell: false,
  };
  const execution = {
    execution_observation: "three-direct-processes-completed",
    policy_sha256: sha256(canonicalJson(policy)),
    process_receipts: processReceipts,
    program: {
      arguments_sha256: sha256(canonicalJson(selectedProgram.arguments)),
      executable_sha256: selectedProgram.executable_sha256,
      support_files_sha256: sha256(
        canonicalJson(
          selectedProgram.support_files.map((supportFile) => ({
            path_sha256: sha256(Buffer.from(supportFile.path, "utf8")),
            sha256: supportFile.sha256,
          })),
        ),
      ),
    },
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    transcript,
    verification_status: "unverified",
  };
  return validateBobHostExecution({
    ...execution,
    execution_sha256: executionDigest(execution),
  });
}
