// `audit_logs.performed_by` was declared, selected and joined, but nothing
// ever wrote it - so the Audit Log report rendered "System" for every change.
// The actor now travels from the authenticated request to the connection the
// write runs on; these pin the parts of that path that are pure logic.
import test from "node:test";
import assert from "node:assert/strict";
import {
  currentAuditActor,
  runWithAuditActor,
  setAuditActor,
  statementMayAudit,
} from "../src/lib/postgres/audit-actor.js";

test("an actor set inside a scope is visible for the rest of it", () => {
  runWithAuditActor(() => {
    assert.equal(currentAuditActor(), null);
    setAuditActor("11111111-1111-1111-1111-111111111111");
    assert.equal(currentAuditActor(), "11111111-1111-1111-1111-111111111111");
  });
});

test("scopes do not leak into each other", () => {
  runWithAuditActor(() => setAuditActor("a"));
  runWithAuditActor(() => {
    assert.equal(currentAuditActor(), null);
  });
});

// Background schedulers and the schema bootstrap write outside any request.
// "System" is the honest author there, so this must not throw or invent one.
test("outside any request there is simply no actor", () => {
  assert.equal(currentAuditActor(), null);
  setAuditActor("a");
  assert.equal(currentAuditActor(), null);
});

test("an actor survives an await inside the scope", async () => {
  await runWithAuditActor(async () => {
    setAuditActor("b");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(currentAuditActor(), "b");
  });
});

test("concurrent scopes keep their own actor", async () => {
  const seen = await Promise.all([
    runWithAuditActor(async () => {
      setAuditActor("first");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentAuditActor();
    }),
    runWithAuditActor(async () => {
      setAuditActor("second");
      return currentAuditActor();
    }),
  ]);
  assert.deepEqual(seen, ["first", "second"]);
});

test("a blank or missing member id is stored as no actor, not as an empty string", () => {
  runWithAuditActor(() => {
    setAuditActor("   ");
    assert.equal(currentAuditActor(), null);
    setAuditActor(undefined);
    assert.equal(currentAuditActor(), null);
  });
});

// Publishing the actor costs a round-trip, so it is only worth paying on
// statements that can actually fire the audit trigger.
test("writes are recognised and reads are not", () => {
  assert.equal(statementMayAudit("UPDATE members SET status = $1"), true);
  assert.equal(statementMayAudit("INSERT INTO members (id) VALUES ($1)"), true);
  assert.equal(statementMayAudit("DELETE FROM roles WHERE id = $1"), true);
  assert.equal(statementMayAudit("SELECT id FROM members WHERE id = $1"), false);
});

// "updated_at" and "created_at" appear in almost every SELECT this codebase
// makes; matching them would put the round-trip back on every read.
test("column names that merely contain a verb are not mistaken for writes", () => {
  assert.equal(statementMayAudit("SELECT updated_at, created_at FROM members"), false);
  assert.equal(statementMayAudit("SELECT id FROM members ORDER BY updated_at DESC"), false);
});
