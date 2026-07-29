import assert from "node:assert/strict";
import { test } from "node:test";

const revision = process.env.CANCELLATION_REVISION;
if (!["base", "candidate"].includes(revision)) {
  throw new Error("CANCELLATION_REVISION must be base or candidate");
}

const { canCancel } = await import(
  new URL(`./${revision}/cancellation.mjs`, import.meta.url)
);

test("accepts a purchase inside the cancellation window", () => {
  assert.equal(canCancel(29, 30), true);
});

test("rejects a purchase after the cancellation window", () => {
  assert.equal(canCancel(31, 30), false);
});
