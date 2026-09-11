import test from "node:test";
import assert from "node:assert/strict";
import {
  describeSessionReason,
  isWebActionOnAgentSession,
  normalizeSessionReason,
  SESSION_REASON_LABELS,
} from "../src/modules/activity/session-reasons.js";

test("known reasons pass through, case and whitespace aside", () => {
  assert.equal(normalizeSessionReason("idle_escalation"), "idle_escalation");
  assert.equal(normalizeSessionReason("  TIMER_CAP "), "timer_cap");
});

// An agent from before reasons existed sends none. It must keep working, and
// the count of "unspecified" rows shows how much of the fleet has not updated.
test("missing or unknown reasons become unspecified, never an error", () => {
  for (const value of [undefined, null, "", "made_up", 42, { reason: "x" }]) {
    assert.equal(normalizeSessionReason(value), "unspecified");
  }
});

test("every reason has a human-readable label", () => {
  for (const reason of Object.keys(SESSION_REASON_LABELS)) {
    assert.ok(describeSessionReason(reason).length > 0);
  }
  assert.equal(describeSessionReason("nonsense"), SESSION_REASON_LABELS.unspecified);
});

// The server-side half of "the agent owns the timer": a dashboard tab still
// running the old code must not be able to pause, stop, resume or overwrite
// an agent's session.
test("dashboard pause, stop, resume and sync on an agent session are refused", () => {
  for (const action of ["idle", "stop", "resume", "sync"]) {
    for (const sessionSource of ["agent", "desktop_agent", "AGENT"]) {
      assert.equal(
        isWebActionOnAgentSession({ sessionSource, requestFromWeb: true, action }),
        true,
        `${action} on a ${sessionSource} session from the web must be refused`,
      );
    }
  }
});

test("the agent drives its own session freely", () => {
  for (const action of ["idle", "stop", "resume", "sync", "start"]) {
    assert.equal(isWebActionOnAgentSession({ sessionSource: "agent", requestFromWeb: false, action }), false);
  }
});

test("a web-started session stays under the web's control", () => {
  for (const action of ["idle", "stop", "resume", "sync"]) {
    assert.equal(isWebActionOnAgentSession({ sessionSource: "web", requestFromWeb: true, action }), false);
  }
});

// Starting is governed by the one-open-session rule, which already answers
// 409 when the agent has a session running.
test("start is left to the one-open-session rule", () => {
  assert.equal(isWebActionOnAgentSession({ sessionSource: "agent", requestFromWeb: true, action: "start" }), false);
});
