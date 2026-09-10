// The audit log report used to ship the raw to_jsonb(OLD)/to_jsonb(NEW)
// snapshot of every member record to the browser and render none of it, so it
// could say a record changed but never which field. This is what replaced it.
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAuditChange } from "../src/lib/postgres/misc-reports-postgres.service.js";

test("an update reports only the fields that actually moved", () => {
  const changes = summarizeAuditChange(
    "UPDATE",
    { id: "1", display_name: "Sam", status: "active", timezone: "UTC" },
    { id: "1", display_name: "Sam", status: "banned", timezone: "UTC" },
  );
  assert.deepEqual(changes, [{ field: "status", from: "active", to: "banned" }]);
});

test("bookkeeping columns are not reported as changes", () => {
  const changes = summarizeAuditChange(
    "UPDATE",
    { status: "active", updated_at: "2026-09-09T00:00:00Z", updated_by: "a" },
    { status: "active", updated_at: "2026-09-10T00:00:00Z", updated_by: "b" },
  );
  assert.deepEqual(changes, []);
});

test("an insert lists the values the record was created with", () => {
  const changes = summarizeAuditChange("INSERT", null, { display_name: "Sam", status: "active" });
  assert.deepEqual(changes, [
    { field: "display_name", from: null, to: "Sam" },
    { field: "status", from: null, to: "active" },
  ]);
});

test("a delete lists what was removed", () => {
  const changes = summarizeAuditChange("DELETE", { display_name: "Sam" }, null);
  assert.deepEqual(changes, [{ field: "display_name", from: "Sam", to: null }]);
});

test("secret-shaped fields are redacted rather than shown", () => {
  const changes = summarizeAuditChange("UPDATE", { api_key: "old-key" }, { api_key: "new-key" });
  assert.deepEqual(changes, [{ field: "api_key", from: "[REDACTED]", to: "[REDACTED]" }]);
});

test("long values are truncated so one row summarises rather than reproduces", () => {
  const long = "x".repeat(400);
  const [change] = summarizeAuditChange("UPDATE", { note: "" }, { note: long });
  assert.equal(change.to.length, 120);
  assert.ok(change.to.endsWith("..."));
});

test("the number of reported fields is capped", () => {
  const before = {};
  const after = {};
  for (let i = 0; i < 40; i++) {
    before[`f${i}`] = "a";
    after[`f${i}`] = "b";
  }
  assert.equal(summarizeAuditChange("UPDATE", before, after).length, 12);
});

test("a field added by an update is reported with a null before", () => {
  const changes = summarizeAuditChange("UPDATE", { a: "1" }, { a: "1", b: "2" });
  assert.deepEqual(changes, [{ field: "b", from: null, to: "2" }]);
});

test("object values are stringified rather than dropped", () => {
  const changes = summarizeAuditChange("UPDATE", { work_days: [0, 1] }, { work_days: [0, 1, 2] });
  assert.deepEqual(changes, [{ field: "work_days", from: "[0,1]", to: "[0,1,2]" }]);
});
