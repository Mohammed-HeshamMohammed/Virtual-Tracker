// Guards TC-7: at most one open activity_sessions row per member.
// findOpenSession() is only a pre-check with a TOCTOU gap - two "start"/
// "resume" requests that both see no open session can both reach
// createPgSession. The partial unique index in ensure-lookup-schema.js is
// the real guarantee; isOneOpenSessionConflict() is what turns the resulting
// Postgres 23505 into a specific, actionable response instead of a generic
// 500.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// --- DDL shape (ensure-lookup-schema.js) ----------------------------------
// No live Postgres in this environment, so this checks the one property that
// matters most for TC-7's safety: the duplicate-cleanup UPDATE appears
// BEFORE the unique index in the DDL list. ensurePostgresLookupSchema()
// applies LOOKUP_DDL in array order inside a single try/catch with no
// per-statement recovery (ensure-lookup-schema.js:872-874) - if the index
// statement ran first against a database with pre-existing duplicate open
// sessions, CREATE UNIQUE INDEX would throw and abort the entire schema
// application for every table, not just this one. That makes ordering here
// a boot-safety property, not a style preference.

const schemaSource = readFileSync(
  fileURLToPath(new URL("../src/lib/postgres/ensure-lookup-schema.js", import.meta.url)),
  "utf8",
);

test("the duplicate-session cleanup runs before the unique index is created", () => {
  const cleanupAt = schemaSource.indexOf("id NOT IN (");
  const indexAt = schemaSource.indexOf("activity_sessions_one_open_per_member");
  assert.ok(cleanupAt > -1, "expected the duplicate-cleanup UPDATE to exist");
  assert.ok(indexAt > -1, "expected the one-open-session unique index to exist");
  assert.ok(cleanupAt < indexAt, "cleanup must run before the index, or the index creation can boot-fail on dirty data");
});

test("both the cleanup and the index are idempotent (safe on every boot)", () => {
  assert.match(schemaSource, /UPDATE activity_sessions\s+SET status = 'stopped'/);
  assert.match(schemaSource, /CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member/);
});

test("the unique index targets exactly the same predicate as the app's open-session queries", () => {
  // findOpenPgSession/fetchAllOpenPgSessions both key "open" as ended_at IS
  // NULL - the index must enforce uniqueness over that same definition of
  // "open", not a different one (e.g. status = 'active' only, which would
  // let a status='idle' row slip through as a second concurrent session).
  const indexStatement = schemaSource.slice(
    schemaSource.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member"),
    schemaSource.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member") + 200,
  );
  assert.match(indexStatement, /member_id/);
  assert.match(indexStatement, /ended_at IS NULL/);
});
