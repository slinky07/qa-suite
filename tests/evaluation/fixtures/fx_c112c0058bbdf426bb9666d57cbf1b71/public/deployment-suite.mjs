import assert from "node:assert/strict";
import { test } from "node:test";
import { runPreflight } from "./rollout.mjs";

test("verifies the healthy v1 release before rollout", async () => {
  const result = await runPreflight();
  assert.equal(result.health_ready, true);
  assert.match(result.artifact_sha256, /^[0-9a-f]{64}$/u);
  assert.match(result.configuration_sha256, /^[0-9a-f]{64}$/u);
});
