// Guards TC-7: at most one open activity_sessions row per member.
// findOpenSession() is only a pre-check with a TOCTOU gap - two "start"/
// "resume" requests that both see no open session can both reach
// createPgSession. The partial unique index in ensure-lookup-schema.js is
// the real guarantee; isOneOpenSessionConflict() is what turns the resulting
// Postgres 23505 into a specific, actionable response instead of a generic
// 500.
import test from "node:test";
import assert from "node:assert/strict";
import { isOneOpenSessionConflict } from "../src/modules/activity/routes.js";

test("recognizes a violation of the one-open-session index", () => {
  const err = Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint: "activity_sessions_one_open_per_member",
  });
  assert.equal(isOneOpenSessionConflict(err), true);
});

test("does not misattribute an unrelated unique violation", () => {
  const err = Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint: "activity_sessions_pkey",
  });
  assert.equal(isOneOpenSessionConflict(err), false);
});

test("does not misattribute a same-code error with no constraint at all", () => {
  const err = Object.assign(new Error("duplicate key value"), { code: "23505" });
  assert.equal(isOneOpenSessionConflict(err), false);
});

test("ignores errors of a different class entirely", () => {
  assert.equal(isOneOpenSessionConflict(new Error("connection refused")), false);
  assert.equal(isOneOpenSessionConflict(null), false);
  assert.equal(isOneOpenSessionConflict("a string, not an Error"), false);
  assert.equal(isOneOpenSessionConflict(undefined), false);
});

// The partial unique index itself, and booting over old data that already has duplicate open
// sessions, are run against real Postgres in session-rows.pglite.test.js.
