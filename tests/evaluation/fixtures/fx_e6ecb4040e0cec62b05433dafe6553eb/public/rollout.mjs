import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rollbackSnapshotPhase = "after";
const fixtureRoot = dirname(fileURLToPath(import.meta.url));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRelease(version) {
  return {
    artifact: await readFile(
      join(fixtureRoot, "artifacts", `service-${version}.json`),
    ),
    configuration: await readFile(
      join(fixtureRoot, "config", `service-${version}.json`),
    ),
  };
}

function copyRelease(release) {
  return {
    artifact: Buffer.from(release.artifact),
    configuration: Buffer.from(release.configuration),
  };
}

function verifyRelease(release) {
  const artifact = JSON.parse(release.artifact.toString("utf8"));
  const configuration = JSON.parse(release.configuration.toString("utf8"));
  return (
    artifact.name === configuration.service &&
    artifact.configuration_generation === configuration.generation &&
    configuration.health === "ready"
  );
}

function measureRelease(release) {
  return {
    artifact_sha256: sha256(release.artifact),
    configuration_sha256: sha256(release.configuration),
    health_ready: verifyRelease(release),
  };
}

export async function runPreflight() {
  return measureRelease(await readRelease("v1"));
}

export async function rehearseRollout() {
  let slot = await readRelease("v1");
  const preRollout = measureRelease(slot);
  let rollbackSnapshot = rollbackSnapshotPhase === "before"
    ? copyRelease(slot)
    : null;

  slot = await readRelease("v2");
  const candidate = measureRelease(slot);
  if (rollbackSnapshotPhase === "after") {
    rollbackSnapshot = copyRelease(slot);
  }
  if (candidate.health_ready) {
    throw new Error("the v2 fixture must fail declared health verification");
  }

  slot = copyRelease(rollbackSnapshot);
  const afterRollback = measureRelease(slot);
  const exactIdentityRestored =
    afterRollback.artifact_sha256 === preRollout.artifact_sha256 &&
    afterRollback.configuration_sha256 ===
      preRollout.configuration_sha256;
  return {
    after_rollback: afterRollback,
    candidate,
    candidate_verification: "failed",
    pre_rollout: preRollout,
    rollback_succeeded: exactIdentityRestored && afterRollback.health_ready,
  };
}

async function resultFor(command) {
  if (command === "preflight") return runPreflight();
  if (command === "rehearse") return rehearseRollout();
  throw new Error("usage: node rollout.mjs <preflight|rehearse>");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await resultFor(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.argv[2] === "rehearse" && !result.rollback_succeeded) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
