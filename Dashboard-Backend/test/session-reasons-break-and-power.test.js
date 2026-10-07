// Pause (at the desk) and Break (away) are told apart, and a computer going to sleep or
// shutting down is a recorded reason rather than "unspecified".
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionReason, describeSessionReason } from "../src/modules/activity/session-reasons.js";

test("the new reasons are kept, not collapsed to unspecified", () => {
  for (const reason of ["member_pause", "member_break", "system_suspend", "system_shutdown", "stale_session_closed"]) {
    assert.equal(normalizeSessionReason(reason), reason);
    assert.notEqual(describeSessionReason(reason), describeSessionReason("unspecified"));
  }
});

test("a pause and a break read differently in reports", () => {
  assert.notEqual(describeSessionReason("member_pause"), describeSessionReason("member_break"));
});
