// PLAN D3: an agent that comes back after the server reaped its session, just after midnight into
// a day off, must be let back in - the shift began on a working day. A fresh start on a rest day
// is still refused.
import test from "node:test";
import assert from "node:assert/strict";
import { dayOffGateApplies } from "../src/modules/activity/recovery-gate.js";

test("a fresh start on a day off is checked", () => {
  assert.equal(dayOffGateApplies({ action: "start", reason: "member_start", hasRecentReap: false }), true);
});

test("D3: re-opening a session the server just reaped is not checked", () => {
  assert.equal(dayOffGateApplies({ action: "start", reason: "recovered_after_reap", hasRecentReap: true }), false);
});

test("the recovery reason alone is not trusted without a reap on record", () => {
  assert.equal(dayOffGateApplies({ action: "start", reason: "recovered_after_reap", hasRecentReap: false }), true);
});

test("a reap on record does not excuse a start that is not a recovery", () => {
  assert.equal(dayOffGateApplies({ action: "start", reason: "member_start", hasRecentReap: true }), true);
});

test("only starts are checked at all (resume and sync never were)", () => {
  assert.equal(dayOffGateApplies({ action: "resume", reason: "x", hasRecentReap: false }), false);
  assert.equal(dayOffGateApplies({ action: "sync", reason: "x", hasRecentReap: false }), false);
});
