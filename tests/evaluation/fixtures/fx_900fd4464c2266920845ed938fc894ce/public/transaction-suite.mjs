import assert from "node:assert/strict";
import { test } from "node:test";
import { runAcknowledgedTransfer } from "./transfer-store.mjs";

test("applies both state changes for an uninterrupted transfer", () => {
  const result = runAcknowledgedTransfer();
  assert.equal(result.acknowledged, true);
  assert.equal(result.interruption_point, null);
  assert.equal(result.state_matches_acknowledged_write, true);
  assert.equal(result.after.record_count, 2);
  assert.equal(result.after.invariant.actual, 100);
  assert.equal(result.after.invariant.holds, true);
  assert.equal(result.after.digest_sha256, result.expected.digest_sha256);
});
