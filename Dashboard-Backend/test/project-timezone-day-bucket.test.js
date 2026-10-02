// The two stored rollups use two calendars on purpose. The member's daily total is booked on
// the member's own day - the reports, counter reconciliation and capture settings all read it as
// "that person's day". The task rollup is booked on the project's day, so a task's daily cap lines
// up with the project. (The member's *limits* no longer read the member rollup at all: they are
// summed from sessions in the calendar they are read in - see sumDailyMemberActiveSeconds.)
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let calls = [];
let responses = [];
let resolvedZone = "UTC";
let memberZone = "UTC";

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    queryRaw: async (sql, params) => {
      calls.push({ sql, params });
      return responses.shift() ?? { rows: [] };
    },
    query: async (sql, params) => {
      calls.push({ sql, params });
      return (responses.shift() ?? { rows: [] }).rows ?? [];
    },
    __closePostgresPoolForTests: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});
mock.module("../src/http/sanitize-error.js", {
  namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
});
mock.module("../src/lib/time/resolve-time-zone.js", {
  namedExports: { resolveProjectTimeZone: async () => resolvedZone },
});
mock.module("../src/modules/reports/member-timezones.js", {
  namedExports: { getMemberTimezone: async () => memberZone, getMemberTimezones: async () => new Map() },
});

const { updatePgSession } = await import("../src/lib/postgres/activity-events-postgres.service.js");

async function rewindAt(startedAt) {
  calls = [];
  responses = [
    { rows: [{ member_id: "m1", task_id: "t1", project_id: "p1", started_at: startedAt, active_seconds: 1000, idle_seconds: 0 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ];
  await updatePgSession("session-1", { status: "stopped", activeSeconds: 940, updatedAt: new Date() }, { allowDecrease: true });
  return {
    member: calls.find((c) => c.sql.includes("INSERT INTO daily_member_active_seconds"))?.params[1],
    task: calls.find((c) => c.sql.includes("INSERT INTO daily_member_task_active_seconds"))?.params[2],
  };
}

test("the task rollup lands on the project's day, the member rollup on the member's", async () => {
  memberZone = "UTC";
  resolvedZone = "Pacific/Kiritimati"; // UTC+14: already Jan 2 when it is noon on Jan 1 in UTC
  const days = await rewindAt(new Date("2026-01-01T12:00:00Z"));
  assert.equal(days.member, "2026-01-01", "member's own calendar");
  assert.equal(days.task, "2026-01-02", "project's calendar");
});

test("and the other way round when the project is behind", async () => {
  memberZone = "UTC";
  resolvedZone = "Pacific/Pago_Pago"; // UTC-11: still Dec 31 at 05:00 on Jan 1 UTC
  const days = await rewindAt(new Date("2026-01-01T05:00:00Z"));
  assert.equal(days.member, "2026-01-01");
  assert.equal(days.task, "2025-12-31");
});

test("a member's zone change moves the member rollup but never the project's", async () => {
  memberZone = "Pacific/Kiritimati";
  resolvedZone = "UTC";
  const days = await rewindAt(new Date("2026-01-01T12:00:00Z"));
  assert.equal(days.member, "2026-01-02");
  assert.equal(days.task, "2026-01-01");
});

test("with no project zone both follow the member's own zone, as before", async () => {
  memberZone = "Africa/Cairo";
  resolvedZone = "Africa/Cairo"; // resolveProjectTimeZone falls back to the member's zone
  const days = await rewindAt(new Date("2026-01-01T23:00:00Z")); // 01:00 on Jan 2 in Cairo
  assert.equal(days.member, "2026-01-02");
  assert.equal(days.task, "2026-01-02");
});
