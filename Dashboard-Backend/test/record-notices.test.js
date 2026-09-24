import test, { mock } from "node:test";
import assert from "node:assert/strict";

let upsertRow = { inserted: true };
const queries = [];
const notifications = [];
let notificationsFail = false;

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("INSERT INTO record_notices")) return [{ ...upsertRow, id: "r1" }];
      return [];
    },
  },
});
mock.module("../src/modules/notifications/service.js", {
  namedExports: {
    createNotification: async (_db, payload) => {
      if (notificationsFail) throw new Error("notifications down");
      notifications.push(payload);
      return "n1";
    },
  },
});
mock.module("../src/modules/reports/member-timezones.js", {
  namedExports: { getMemberTimezone: async () => "UTC" },
});

const { recordNotice, NOTICE_KINDS } = await import("../src/modules/activity/record-notices.js");

function reset(inserted = true) {
  queries.length = 0;
  notifications.length = 0;
  upsertRow = { inserted };
  notificationsFail = false;
}

test("a first occurrence records the row and tells the member", async () => {
  reset(true);
  const row = await recordNotice({ memberId: "m1", kind: "session_reaped", secondsAffected: 1800 });
  assert.ok(row);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, "m1");
  assert.equal(notifications[0].type, "record_notice");
  assert.match(notifications[0].title, /timer was stopped/i);
});

test("a repeat on the same day adds to the row without a second message", async () => {
  // The whole point of the unique key: a flapping agent must not produce
  // fifty notifications for one bad afternoon.
  reset(false);
  const row = await recordNotice({ memberId: "m1", kind: "work_dropped" });
  assert.ok(row);
  assert.equal(notifications.length, 0);
});

test("the upsert accumulates rather than overwrites", async () => {
  reset(true);
  await recordNotice({ memberId: "m1", kind: "work_dropped", secondsAffected: 60 });
  const insert = queries.find((q) => q.sql.includes("INSERT INTO record_notices"));
  assert.match(insert.sql, /seconds_affected = record_notices\.seconds_affected \+ EXCLUDED\.seconds_affected/);
  assert.match(insert.sql, /occurrences = record_notices\.occurrences \+ 1/);
});

test("an unknown kind is refused rather than written", async () => {
  reset(true);
  assert.equal(await recordNotice({ memberId: "m1", kind: "whatever" }), null);
  assert.equal(queries.length, 0);
});

test("no member means nothing is written", async () => {
  reset(true);
  assert.equal(await recordNotice({ memberId: "", kind: "work_dropped" }), null);
  assert.equal(queries.length, 0);
});

test("the dropped-work message never invents a number of minutes", async () => {
  // The tracker discards whole upload batches and cannot say how much time
  // each held, so a figure there would be fabricated.
  reset(true);
  await recordNotice({ memberId: "m1", kind: "work_dropped", secondsAffected: 0 });
  assert.doesNotMatch(notifications[0].message, /\d+ minute/);
});

test("a failed notification still leaves the row recorded", async () => {
  reset(true);
  notificationsFail = true;
  const row = await recordNotice({ memberId: "m1", kind: "session_reaped", secondsAffected: 10 });
  assert.ok(row, "the row is the record of what happened and must survive");
  assert.equal(notifications.length, 0);
});

test("every kind has copy, so none can notify with an undefined title", () => {
  assert.deepEqual([...NOTICE_KINDS].sort(), ["session_reaped", "totals_mismatch", "work_dropped"]);
});
