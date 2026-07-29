import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  canonicalJson,
  sha256,
} from "./contracts.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const THREAD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ZERO_DIGEST = "0".repeat(64);
const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const CLAIMS = Object.freeze({
  controller_key_continuity: "ed25519-chain-verified",
  identity_authentication: "not-attested",
  provider_authentication: "not-attested",
  sandbox_qualification: "not-attested",
});
const INPUT_FIELDS = Object.freeze([
  "atomic_receipt_sha256",
  "auth_observation_sha256",
  "codex_jsonl_sha256",
  "gateway_binding_sha256",
  "host_policy_sha256",
  "output_sha256",
  "phase",
  "process_receipt_sha256",
  "prompt_input_sha256",
  "request_sha256",
  "terminal_status",
  "thread_id",
]);
const TRANSITION_FIELDS = Object.freeze([
  ...INPUT_FIELDS,
  "previous_transition_sha256",
  "sequence",
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

function assertDenseArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} items`);
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

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function decodeBase64(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64.test(value)
  ) {
    throw new Error(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`${label} must be canonical base64`);
  }
  return bytes;
}

function snapshotInput(value, expectedPhase, label) {
  assertExactKeys(value, INPUT_FIELDS, label);
  const input = structuredClone(value);
  if (input.phase !== expectedPhase) {
    throw new Error(`${label}.phase must equal ${expectedPhase}`);
  }
  if (input.terminal_status !== "completed") {
    throw new Error(`${label}.terminal_status must equal completed`);
  }
  if (
    typeof input.thread_id !== "string" ||
    !THREAD_ID.test(input.thread_id)
  ) {
    throw new Error(`${label}.thread_id is invalid`);
  }
  for (const name of INPUT_FIELDS.filter((name) => name.endsWith("_sha256"))) {
    assertDigest(input[name], `${label}.${name}`);
  }
  return input;
}

function publicKeyRecord(publicKey) {
  const bytes = publicKey.export({
    format: "der",
    type: "spki",
  });
  return Object.freeze({
    algorithm: "Ed25519",
    encoding: "spki-der-base64",
    sha256: sha256(bytes),
    value: bytes.toString("base64"),
  });
}

function validatePublicKey(value) {
  assertExactKeys(
    value,
    ["algorithm", "encoding", "sha256", "value"],
    "Codex session chain.public_key",
  );
  if (
    value.algorithm !== "Ed25519" ||
    value.encoding !== "spki-der-base64"
  ) {
    throw new Error("Codex session chain public key format is invalid");
  }
  const bytes = decodeBase64(
    value.value,
    "Codex session chain.public_key.value",
  );
  assertDigest(value.sha256, "Codex session chain.public_key.sha256");
  if (sha256(bytes) !== value.sha256) {
    throw new Error("Codex session chain public key digest does not match");
  }
  let key;
  try {
    key = createPublicKey({
      format: "der",
      key: bytes,
      type: "spki",
    });
  } catch {
    throw new Error("Codex session chain public key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Codex session chain public key must be Ed25519");
  }
  const canonicalBytes = key.export({
    format: "der",
    type: "spki",
  });
  if (!canonicalBytes.equals(bytes)) {
    throw new Error("Codex session chain public key must use canonical SPKI");
  }
  return key;
}

function validateRecord(value, index, previousSha256, publicKey) {
  const label = `Codex session chain.transitions[${index}]`;
  assertExactKeys(
    value,
    [
      "canonical_transition",
      "signature",
      "transition",
      "transition_sha256",
    ],
    label,
  );
  const transition = structuredClone(value.transition);
  const canonicalTransitionValue = value.canonical_transition;
  const signatureValue = value.signature;
  const transitionSha256 = value.transition_sha256;
  assertExactKeys(transition, TRANSITION_FIELDS, `${label}.transition`);
  const input = snapshotInput(
    Object.fromEntries(INPUT_FIELDS.map((name) => [name, transition[name]])),
    PHASES[index],
    `${label}.transition`,
  );
  if (
    transition.sequence !== index + 1 ||
    transition.previous_transition_sha256 !== previousSha256
  ) {
    throw new Error(`${label} breaks the fixed state-transition order`);
  }
  const expectedTransition = {
    ...input,
    previous_transition_sha256: previousSha256,
    sequence: index + 1,
  };
  const canonicalTransition = canonicalJson(expectedTransition);
  if (canonicalTransitionValue !== canonicalTransition) {
    throw new Error(`${label}.canonical_transition does not match`);
  }
  assertDigest(transitionSha256, `${label}.transition_sha256`);
  if (sha256(canonicalTransition) !== transitionSha256) {
    throw new Error(`${label}.transition_sha256 does not match`);
  }
  const signature = decodeBase64(signatureValue, `${label}.signature`);
  if (
    signature.length !== 64 ||
    !verify(
      null,
      Buffer.from(canonicalTransition, "utf8"),
      publicKey,
      signature,
    )
  ) {
    throw new Error(`${label}.signature does not verify`);
  }
  return {
    canonical_transition: canonicalTransition,
    signature: signatureValue,
    transition: expectedTransition,
    transition_sha256: transitionSha256,
  };
}

export function validateCodexSessionChain(value) {
  assertExactKeys(
    value,
    [
      "claims",
      "public_key",
      "qualification",
      "result",
      "schema_version",
      "terminal_transition_sha256",
      "transitions",
      "verification_status",
    ],
    "Codex session chain",
  );
  const schemaVersion = value.schema_version;
  const verificationStatus = value.verification_status;
  const qualification = value.qualification;
  const result = value.result;
  const claims = structuredClone(value.claims);
  const publicKeyValue = structuredClone(value.public_key);
  const transitionValues = value.transitions;
  const terminalTransitionSha256 = value.terminal_transition_sha256;
  if (
    schemaVersion !== 1 ||
    verificationStatus !== "unverified" ||
    qualification !== "not-evidence" ||
    result !== null
  ) {
    throw new Error("Codex session chain must remain non-qualifying");
  }
  assertExactKeys(claims, Object.keys(CLAIMS), "Codex session chain.claims");
  if (canonicalJson(claims) !== canonicalJson(CLAIMS)) {
    throw new Error("Codex session chain claims exceed controller-key continuity");
  }
  const publicKey = validatePublicKey(publicKeyValue);
  assertDenseArray(
    transitionValues,
    PHASES.length,
    "Codex session chain.transitions",
  );
  const transitions = [];
  let previousSha256 = ZERO_DIGEST;
  for (let index = 0; index < PHASES.length; index += 1) {
    const record = validateRecord(
      transitionValues[index],
      index,
      previousSha256,
      publicKey,
    );
    transitions.push(record);
    previousSha256 = record.transition_sha256;
  }
  assertDigest(
    terminalTransitionSha256,
    "Codex session chain.terminal_transition_sha256",
  );
  if (terminalTransitionSha256 !== previousSha256) {
    throw new Error("Codex session chain terminal transition does not match");
  }
  return {
    claims: structuredClone(CLAIMS),
    public_key: publicKeyValue,
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    terminal_transition_sha256: previousSha256,
    transitions,
    verification_status: "unverified",
  };
}

export function codexSessionChainSha256(value) {
  return sha256(canonicalJson(validateCodexSessionChain(value)));
}

export function createCodexSessionChainSigner() {
  let { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const retainedPublicKey = publicKeyRecord(publicKey);
  publicKey = undefined;
  let closed = false;
  let transitions = [];

  function appendTransition(value) {
    if (closed) {
      throw new Error("Codex session chain signer is closed");
    }
    if (transitions.length === PHASES.length) {
      throw new Error("Codex session chain already contains three transitions");
    }
    const index = transitions.length;
    const input = snapshotInput(
      value,
      PHASES[index],
      `Codex session transition input[${index}]`,
    );
    const previousSha256 =
      transitions.at(-1)?.transition_sha256 ?? ZERO_DIGEST;
    const transition = {
      ...input,
      previous_transition_sha256: previousSha256,
      sequence: index + 1,
    };
    const canonicalTransition = canonicalJson(transition);
    const record = {
      canonical_transition: canonicalTransition,
      signature: sign(
        null,
        Buffer.from(canonicalTransition, "utf8"),
        privateKey,
      ).toString("base64"),
      transition,
      transition_sha256: sha256(canonicalTransition),
    };
    transitions = [...transitions, record];
    return structuredClone(record);
  }

  function close() {
    if (closed) {
      throw new Error("Codex session chain signer is closed");
    }
    if (transitions.length !== PHASES.length) {
      throw new Error("Codex session chain requires exactly three transitions");
    }
    const chain = {
      claims: structuredClone(CLAIMS),
      public_key: structuredClone(retainedPublicKey),
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      terminal_transition_sha256: transitions.at(-1).transition_sha256,
      transitions: structuredClone(transitions),
      verification_status: "unverified",
    };
    const validated = validateCodexSessionChain(chain);
    closed = true;
    privateKey = undefined;
    transitions = [];
    return validated;
  }

  return Object.freeze({
    appendTransition,
    close,
    public_key: retainedPublicKey,
  });
}
