import test from "node:test";
import assert from "node:assert/strict";
import { batchCaptureTime } from "../src/modules/activity/capture-time.js";

const now = new Date("2026-11-06T12:00:00Z");

test("a stamped batch is recorded at its capture time, not the retry time", () => {
  const at = now.getTime() - 3 * 60 * 60 * 1000;
  assert.equal(batchCaptureTime(at, now).getTime(), at);
});

test("a missing, wrong, future or ancient stamp falls back to the server clock", () => {
  for (const bad of [undefined, null, "x", NaN, now.getTime() + 60_000, now.getTime() - 8 * 24 * 3600 * 1000]) {
    assert.equal(batchCaptureTime(bad, now), now);
  }
});
