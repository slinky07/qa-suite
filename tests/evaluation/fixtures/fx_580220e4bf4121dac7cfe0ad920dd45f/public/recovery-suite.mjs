import assert from "node:assert/strict";
import { test } from "node:test";
import { runHealthyOperation } from "./recovery-scenario.mjs";

test("produces a dispatch summary while the dependency is healthy", () => {
  assert.deepEqual(runHealthyOperation(), {
    alert_state: "clear",
    dependency_state: "available",
    dispatch_summary_available: true,
    service_state: "ready",
  });
});
