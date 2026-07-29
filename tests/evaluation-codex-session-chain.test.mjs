import assert from "node:assert/strict";
import {
  createPublicKey,
  verify,
} from "node:crypto";
import { test } from "node:test";
import {
  codexSessionChainSha256,
  createCodexSessionChainSigner,
  validateCodexSessionChain,
} from "../scripts/evaluation/codex-session-chain.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const PHASES = Object.freeze([
  "interface_inventory",
  "expected_use_model",
  "task_execution",
]);
const TRANSITION_FIELDS = Object.freeze([
  "atomic_receipt_sha256",
  "auth_observation_sha256",
  "codex_jsonl_sha256",
  "gateway_binding_sha256",
  "host_policy_sha256",
  "output_sha256",
  "phase",
  "previous_transition_sha256",
  "process_receipt_sha256",
  "prompt_input_sha256",
  "request_sha256",
  "sequence",
  "terminal_status",
  "thread_id",
]);

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function input(phase, index) {
  return {
    atomic_receipt_sha256: digest(`${index}:atomic receipt`),
    auth_observation_sha256: digest(`${index}:auth observation`),
    codex_jsonl_sha256: digest(`${index}:Codex JSONL`),
    gateway_binding_sha256: digest(`${index}:gateway binding`),
    host_policy_sha256: digest(`${index}:host policy`),
    output_sha256: digest(`${index}:output`),
    phase,
    process_receipt_sha256: digest(`${index}:process receipt`),
    prompt_input_sha256: digest(`${index}:prompt input`),
    request_sha256: digest(`${index}:request`),
    terminal_status: "completed",
    thread_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
  };
}

function buildChain() {
  const signer = createCodexSessionChainSigner();
  const records = PHASES.map((phase, index) =>
    signer.appendTransition(input(phase, index))
  );
  return {
    chain: signer.close(),
    records,
    signer,
  };
}

function mutateTransition(chain, index, name, replacement) {
  const copy = structuredClone(chain);
  copy.transitions[index].transition[name] = replacement;
  copy.transitions[index].canonical_transition = canonicalJson(
    copy.transitions[index].transition,
  );
  copy.transitions[index].transition_sha256 = sha256(
    copy.transitions[index].canonical_transition,
  );
  return copy;
}

test("signs and externally verifies the fixed three-phase state chain", () => {
  const signer = createCodexSessionChainSigner();
  assert.deepEqual(
    Object.keys(signer).sort(),
    ["appendTransition", "close", "public_key"],
  );
  assert.equal(Object.isFrozen(signer), true);
  assert.equal(Object.isFrozen(signer.public_key), true);
  assert.doesNotMatch(JSON.stringify(signer), /private|secret/u);

  const suppliedInputs = PHASES.map((phase, index) => input(phase, index));
  const records = suppliedInputs.map((value) =>
    signer.appendTransition(value)
  );
  suppliedInputs[0].host_policy_sha256 = "f".repeat(64);
  const chain = signer.close();

  assert.deepEqual(validateCodexSessionChain(chain), chain);
  assert.equal(
    codexSessionChainSha256(chain),
    sha256(canonicalJson(chain)),
  );
  assert.equal(chain.verification_status, "unverified");
  assert.equal(chain.qualification, "not-evidence");
  assert.equal(chain.result, null);
  assert.deepEqual(chain.claims, {
    controller_key_continuity: "ed25519-chain-verified",
    identity_authentication: "not-attested",
    provider_authentication: "not-attested",
    sandbox_qualification: "not-attested",
  });
  assert.equal(chain.transitions.length, 3);
  assert.equal(
    chain.transitions[0].transition.host_policy_sha256,
    input(PHASES[0], 0).host_policy_sha256,
  );

  const publicKey = createPublicKey({
    format: "der",
    key: Buffer.from(chain.public_key.value, "base64"),
    type: "spki",
  });
  let previousSha256 = "0".repeat(64);
  chain.transitions.forEach((record, index) => {
    assert.deepEqual(
      Object.keys(record.transition).sort(),
      [...TRANSITION_FIELDS].sort(),
    );
    assert.equal(record.transition.sequence, index + 1);
    assert.equal(record.transition.phase, PHASES[index]);
    assert.equal(
      record.transition.previous_transition_sha256,
      previousSha256,
    );
    assert.equal(
      record.canonical_transition,
      canonicalJson(record.transition),
    );
    assert.equal(
      record.transition_sha256,
      sha256(record.canonical_transition),
    );
    assert.equal(
      verify(
        null,
        Buffer.from(record.canonical_transition, "utf8"),
        publicKey,
        Buffer.from(record.signature, "base64"),
      ),
      true,
    );
    assert.deepEqual(record, records[index]);
    previousSha256 = record.transition_sha256;
  });
  assert.equal(chain.terminal_transition_sha256, previousSha256);
});

test("requires exactly three dense transitions in fixed phase order", () => {
  const { chain } = buildChain();

  const dropped = structuredClone(chain);
  dropped.transitions.pop();
  assert.throws(
    () => validateCodexSessionChain(dropped),
    /exactly 3/u,
  );

  const extra = structuredClone(chain);
  extra.transitions.push(extra.transitions[0]);
  assert.throws(
    () => validateCodexSessionChain(extra),
    /exactly 3/u,
  );

  const reordered = structuredClone(chain);
  [
    reordered.transitions[0],
    reordered.transitions[1],
  ] = [
    reordered.transitions[1],
    reordered.transitions[0],
  ];
  assert.throws(
    () => validateCodexSessionChain(reordered),
    /phase|order/u,
  );

  const duplicate = structuredClone(chain);
  duplicate.transitions[1] = duplicate.transitions[0];
  assert.throws(
    () => validateCodexSessionChain(duplicate),
    /phase|order/u,
  );

  const sparse = structuredClone(chain);
  delete sparse.transitions[1];
  assert.throws(
    () => validateCodexSessionChain(sparse),
    /dense/u,
  );

  const named = structuredClone(chain);
  named.transitions.note = "not a transition";
  assert.throws(
    () => validateCodexSessionChain(named),
    /named properties/u,
  );
});

test("rejects transition field and digest substitution after local rehash", () => {
  const { chain } = buildChain();
  const substitutions = [
    ["host_policy_sha256", digest("substituted host policy")],
    ["request_sha256", digest("substituted request")],
    ["codex_jsonl_sha256", digest("substituted Codex JSONL")],
    ["gateway_binding_sha256", digest("substituted gateway binding")],
    ["atomic_receipt_sha256", digest("substituted atomic receipt")],
    ["auth_observation_sha256", digest("substituted auth observation")],
    ["process_receipt_sha256", digest("substituted process receipt")],
    ["prompt_input_sha256", digest("substituted prompt input")],
    ["output_sha256", digest("substituted output")],
    ["terminal_status", "qualified"],
    ["thread_id", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
  ];
  for (const [name, replacement] of substitutions) {
    assert.throws(
      () => validateCodexSessionChain(
        mutateTransition(chain, 1, name, replacement),
      ),
      /completed|signature|verify/u,
      name,
    );
  }

  const previous = mutateTransition(
    chain,
    1,
    "previous_transition_sha256",
    digest("substituted previous transition"),
  );
  assert.throws(
    () => validateCodexSessionChain(previous),
    /order/u,
  );

  const sequence = mutateTransition(chain, 1, "sequence", 3);
  assert.throws(
    () => validateCodexSessionChain(sequence),
    /order/u,
  );

  const phase = mutateTransition(
    chain,
    1,
    "phase",
    "task_execution",
  );
  assert.throws(
    () => validateCodexSessionChain(phase),
    /phase/u,
  );

  const transitionDigest = structuredClone(chain);
  transitionDigest.transitions[1].transition_sha256 = "f".repeat(64);
  assert.throws(
    () => validateCodexSessionChain(transitionDigest),
    /transition_sha256/u,
  );

  const terminalDigest = structuredClone(chain);
  terminalDigest.terminal_transition_sha256 = "f".repeat(64);
  assert.throws(
    () => validateCodexSessionChain(terminalDigest),
    /terminal transition/u,
  );
});

test("rejects signature and public-key substitution", () => {
  const { chain } = buildChain();

  const signature = structuredClone(chain);
  signature.transitions[1].signature =
    Buffer.alloc(64, 1).toString("base64");
  assert.throws(
    () => validateCodexSessionChain(signature),
    /signature does not verify/u,
  );

  const otherSigner = createCodexSessionChainSigner();
  const publicKey = structuredClone(chain);
  publicKey.public_key = structuredClone(otherSigner.public_key);
  assert.throws(
    () => validateCodexSessionChain(publicKey),
    /signature does not verify/u,
  );

  const publicKeyDigest = structuredClone(chain);
  publicKeyDigest.public_key.sha256 = "f".repeat(64);
  assert.throws(
    () => validateCodexSessionChain(publicKeyDigest),
    /public key digest/u,
  );

  const malformedPublicKey = structuredClone(chain);
  malformedPublicKey.public_key.value = Buffer.alloc(32).toString("base64");
  malformedPublicKey.public_key.sha256 = sha256(
    Buffer.from(malformedPublicKey.public_key.value, "base64"),
  );
  assert.throws(
    () => validateCodexSessionChain(malformedPublicKey),
    /public key is invalid/u,
  );
});

test("rejects qualification promotion and widened claims", () => {
  const { chain } = buildChain();
  for (const [name, replacement] of [
    ["verification_status", "verified"],
    ["qualification", "evidence"],
    ["result", {}],
  ]) {
    const promoted = structuredClone(chain);
    promoted[name] = replacement;
    assert.throws(
      () => validateCodexSessionChain(promoted),
      /non-qualifying/u,
      name,
    );
  }

  for (const [name, replacement] of [
    ["controller_key_continuity", "provider-authenticated"],
    ["identity_authentication", "verified"],
    ["provider_authentication", "verified"],
    ["sandbox_qualification", "verified"],
  ]) {
    const promoted = structuredClone(chain);
    promoted.claims[name] = replacement;
    assert.throws(
      () => validateCodexSessionChain(promoted),
      /claims exceed/u,
      name,
    );
  }
});

test("rejects extra fields at every retained contract layer", () => {
  const { chain } = buildChain();
  for (const path of [
    "chain",
    "claims",
    "public_key",
    "record",
    "transition",
  ]) {
    const extra = structuredClone(chain);
    if (path === "chain") extra.unexpected = true;
    if (path === "claims") extra.claims.unexpected = true;
    if (path === "public_key") extra.public_key.unexpected = true;
    if (path === "record") extra.transitions[0].unexpected = true;
    if (path === "transition") {
      extra.transitions[0].transition.unexpected = true;
    }
    assert.throws(
      () => validateCodexSessionChain(extra),
      /fields are/u,
      path,
    );
  }

  const signer = createCodexSessionChainSigner();
  const widenedInput = {
    ...input(PHASES[0], 0),
    unexpected: true,
  };
  assert.throws(
    () => signer.appendTransition(widenedInput),
    /fields are/u,
  );
});

test("closes once, rejects incomplete close, and cannot be reused", () => {
  const incomplete = createCodexSessionChainSigner();
  incomplete.appendTransition(input(PHASES[0], 0));
  assert.throws(
    () => incomplete.close(),
    /exactly three/u,
  );
  incomplete.appendTransition(input(PHASES[1], 1));
  incomplete.appendTransition(input(PHASES[2], 2));
  const chain = incomplete.close();
  assert.deepEqual(validateCodexSessionChain(chain), chain);
  assert.throws(
    () => incomplete.appendTransition(input(PHASES[0], 0)),
    /closed/u,
  );
  assert.throws(
    () => incomplete.close(),
    /closed/u,
  );

  const full = createCodexSessionChainSigner();
  PHASES.forEach((phase, index) => {
    full.appendTransition(input(phase, index));
  });
  assert.throws(
    () => full.appendTransition(input(PHASES[0], 3)),
    /already contains three/u,
  );
  assert.deepEqual(validateCodexSessionChain(full.close()).transitions.length, 3);
});

test("rejects noncanonical signatures and invalid transition inputs", () => {
  const { chain } = buildChain();
  const signature = structuredClone(chain);
  signature.transitions[0].signature = "AA";
  assert.throws(
    () => validateCodexSessionChain(signature),
    /canonical base64/u,
  );

  for (const changed of [
    { phase: PHASES[1] },
    { terminal_status: "failed" },
    { request_sha256: "invalid" },
    { thread_id: "invalid" },
  ]) {
    const signer = createCodexSessionChainSigner();
    assert.throws(
      () => signer.appendTransition({
        ...input(PHASES[0], 0),
        ...changed,
      }),
      /phase|completed|SHA-256|thread_id/u,
    );
  }
});
