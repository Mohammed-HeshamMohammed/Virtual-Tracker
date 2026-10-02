// A member's daily total is booked on the day it is in the project's calendar when the project
// has one, so the daily/weekly limits (read in the same calendar) see it. With no project zone
// resolveProjectTimeZone returns the member's own zone, and nothing changes.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let calls = [];
let responses = [];
let resolvedZone = "UTC";

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
  namedExports: { getMemberTimezone: async () => "UTC", getMemberTimezones: async () => new Map() },
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

test("work lands on the project's day when the project is ahead of the member's zone", async () => {
  resolvedZone = "Pacific/Kiritimati"; // UTC+14
  const days = await rewindAt(new Date("2026-01-01T12:00:00Z")); // already Jan 2 there
  assert.equal(days.member, "2026-01-02");
  assert.equal(days.task, "2026-01-02");
});

test("and on the earlier day when the project is behind", async () => {
  resolvedZone = "Pacific/Pago_Pago"; // UTC-11
  const days = await rewindAt(new Date("2026-01-01T05:00:00Z")); // still Dec 31 there
  assert.equal(days.member, "2025-12-31");
  assert.equal(days.task, "2025-12-31");
});

test("with no project zone the member's own zone decides, as before", async () => {
  resolvedZone = "UTC";
  const days = await rewindAt(new Date("2026-01-01T12:00:00Z"));
  assert.equal(days.member, "2026-01-01");
});
