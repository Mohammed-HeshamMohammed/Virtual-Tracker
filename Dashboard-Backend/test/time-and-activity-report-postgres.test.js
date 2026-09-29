// getManualTimeEntryRowsPg's `day` field used to be String(row.date).slice(0, 10).
// pg returns a DATE column as a JS Date, and String(aDate) formats it in the
// server's LOCAL timezone ("Mon Sep 28 2026 03:00:00 GMT+0300 ...") rather than
// as YYYY-MM-DD - slicing that gave "Mon Sep 28", not an ISO day. Every real ISO
// day key sorts before any string starting with a letter, so
// build-time-and-activity-rows.js's `row.day > toDay` range check treated that
// as always out of range and silently dropped every manual entry, for every
// member, unconditionally - a member whose only activity in a range was manual
// time never appeared in the Time & Activity report at all.
import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => [
      {
        member_id: "m1",
        project_id: "p1",
        // What pg actually returns for a DATE column: a JS Date at UTC midnight,
        // not a string.
        date: new Date("2026-09-28T00:00:00.000Z"),
        duration: 28800,
        project_name: "Bana Properties Campaign",
        client_name: "",
        team_name: "",
      },
    ],
  },
});

const { getManualTimeEntryRowsPg } = await import("../src/lib/postgres/time-and-activity-report-postgres.service.js");

test("a manual entry's day survives pg returning DATE as a real Date object, not a string", async () => {
  const rows = await getManualTimeEntryRowsPg({ memberIds: null, fromDay: "2026-09-28", toDay: "2026-09-28" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, "2026-09-28", "must be an ISO day key, not Date's toString() ('Mon Sep 28 ...')");
});
