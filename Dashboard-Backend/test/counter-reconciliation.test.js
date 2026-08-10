// Guards OBS-1: the three counter stores must be *compared*, never
// auto-corrected - a discrepancy is the alarm this job exists to raise, and
// silently fixing it would hide the very bug it's meant to surface.
import test from "node:test";
import assert from "node:assert/strict";
import { findDriftedMembers, DAILY_DRIFT_THRESHOLD_SECONDS } from "../src/modules/activity/counter-reconciliation.js";

test("stores that agree exactly produce no drift", () => {
  const a = new Map([["m1", 3600]]);
  const b = new Map([["m1", 3600]]);
  assert.deepEqual(findDriftedMembers(a, b, DAILY_DRIFT_THRESHOLD_SECONDS), []);
});

test("a difference within the threshold is not reported", () => {
  const a = new Map([["m1", 3600]]);
  const b = new Map([["m1", 3605]]);
  assert.deepEqual(findDriftedMembers(a, b, 10), []);
});

test("a difference beyond the threshold is reported with both values and the diff", () => {
  const a = new Map([["m1", 3600]]);
  const b = new Map([["m1", 3550]]);
  const drifted = findDriftedMembers(a, b, 10);
  assert.equal(drifted.length, 1);
  assert.deepEqual(drifted[0], { memberId: "m1", a: 3600, b: 3550, diffSeconds: 50 });
});

test("a member present in only one store is treated as 0 in the other, not skipped", () => {
  const a = new Map([["m1", 100]]);
  const b = new Map();
  const drifted = findDriftedMembers(a, b, 10);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].b, 0);
});

test("direction of the difference does not matter - drift is absolute", () => {
  const higherInA = findDriftedMembers(new Map([["m1", 100]]), new Map([["m1", 50]]), 10);
  const higherInB = findDriftedMembers(new Map([["m1", 50]]), new Map([["m1", 100]]), 10);
  assert.equal(higherInA[0].diffSeconds, 50);
  assert.equal(higherInB[0].diffSeconds, 50);
});

test("multiple members are checked independently - one drifted member does not hide another", () => {
  const a = new Map([
    ["m1", 100],
    ["m2", 200],
  ]);
  const b = new Map([
    ["m1", 100], // agrees
    ["m2", 50], // drifted
  ]);
  const drifted = findDriftedMembers(a, b, 10);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].memberId, "m2");
});
