// Guards assertManualTimeEntryWithinLimits - the gate that stops a manual
// time entry (Manual Time form, "Add time for someone") from silently
// blowing past a member's own daily/weekly cap or a project's own
// per-member limit, which a live tracked session is already stopped at
// (timer-limit.service.js) but a hand-typed entry previously had zero
// awareness of either.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const HOUR = 3600;

/** @type {{ daily: number, weekly: number, shifts: boolean, trackedSeconds: Record<string, number>, projectLimit: object | null, projectSpentSeconds: number, rate: number }} */
const stub = {
  daily: 0,
  weekly: 0,
  shifts: false,
  // Keyed by "fromDay|toDay" so different-window calls (daily vs weekly)
  // in the same test can return different totals.
  trackedSeconds: {},
  projectLimit: null,
  projectSpentSeconds: 0,
  rate: 0,
};

mock.module("../src/modules/tasks/task-workload-validation.js", {
  namedExports: {
    getMemberLimitHours: async (_db, _id, period) => (period === "daily" ? stub.daily : stub.weekly),
    memberUsesShiftsForLimits: async () => stub.shifts,
  },
});

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectMemberLimitPg: async () => stub.projectLimit,
    getProjectTrackedSecondsPg: async () => stub.projectSpentSeconds,
    resolveMemberHourlyRatePg: async () => stub.rate,
  },
});

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      // The member-scoped tracked+manual query always carries fromDay/toDay
      // as params[1]/params[2] (member_id is params[0]).
      const key = `${params[1]}|${params[2]}`;
      return [{ total_seconds: stub.trackedSeconds[key] ?? 0 }];
    },
  },
});

const { assertManualTimeEntryWithinLimits } = await import("../src/modules/tasks/manual-time-entry-limits.js");

function reset() {
  stub.daily = 0;
  stub.weekly = 0;
  stub.shifts = false;
  stub.trackedSeconds = {};
  stub.projectLimit = null;
  stub.projectSpentSeconds = 0;
  stub.rate = 0;
}

test("no limits configured at all is a no-op", async () => {
  reset();
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 20 * HOUR }),
  );
});

test("a daily limit blocks an entry that pushes the day's total over it", async () => {
  reset();
  stub.daily = 8;
  stub.trackedSeconds["2026-08-25|2026-08-25"] = 7 * HOUR; // already worked 7h that day
  await assert.rejects(
    () => assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 2 * HOUR }),
    /over this member's 8h daily limit/,
  );
});

test("a daily limit does not block an entry that stays within it", async () => {
  reset();
  stub.daily = 8;
  stub.trackedSeconds["2026-08-25|2026-08-25"] = 5 * HOUR;
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 2 * HOUR }),
  );
});

test("exactly at the daily cap is not blocked - the boundary is inclusive of the limit", async () => {
  reset();
  stub.daily = 8;
  stub.trackedSeconds["2026-08-25|2026-08-25"] = 6 * HOUR;
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 2 * HOUR }),
  );
});

test("a weekly limit blocks an entry that pushes that week's total over it, using the Monday-start week containing the entry's own date", async () => {
  reset();
  stub.weekly = 40;
  // 2026-08-25 is a Tuesday - its week is Mon 2026-08-24 .. Sun 2026-08-30.
  stub.trackedSeconds["2026-08-24|2026-08-30"] = 39 * HOUR;
  await assert.rejects(
    () => assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 2 * HOUR }),
    /over this member's 40h weekly limit/,
  );
});

test("shift-based members skip the daily/weekly personal caps entirely - same exemption the live timer already applies", async () => {
  reset();
  stub.shifts = true;
  stub.daily = 1; // would otherwise trivially block
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 20 * HOUR }),
  );
});

test("an hours-based project member limit blocks an entry that pushes this member's project time over it", async () => {
  reset();
  stub.projectLimit = { type: "Hours based", cost: 10, resets: "Never", start_date: null };
  stub.projectSpentSeconds = 9 * HOUR;
  await assert.rejects(
    () => assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 2 * HOUR }),
    /over its 10h limit for this member/,
  );
});

test("a dollar-based project member limit converts through the member's rate", async () => {
  reset();
  stub.projectLimit = { type: "Cost based", based_on: "Pay rate", cost: 100, resets: "Never", start_date: null };
  stub.rate = 10; // $10/hr -> 10h cap
  stub.projectSpentSeconds = 9 * HOUR;
  await assert.rejects(
    () => assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 2 * HOUR }),
    /over its \$100 limit for this member/,
  );
});

test("a dollar-based project member limit with no rate configured does not block - matches the live timer's own choice not to make the project untrackable over a missing rate", async () => {
  reset();
  stub.projectLimit = { type: "Cost based", based_on: "Pay rate", cost: 100, resets: "Never", start_date: null };
  stub.rate = 0;
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 999 * HOUR }),
  );
});

test("a project member limit whose start date is still in the future is not enforced yet", async () => {
  reset();
  stub.projectLimit = { type: "Hours based", cost: 1, resets: "Never", start_date: "2099-01-01" };
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 999 * HOUR }),
  );
});

test("a zero/absent project member limit cap is not a limit", async () => {
  reset();
  stub.projectLimit = { type: "Hours based", cost: 0, resets: "Never", start_date: null };
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: "p1", date: "2026-08-25", durationSeconds: 999 * HOUR }),
  );
});

test("no project in play means the project-member limit cannot apply, even if one exists for another project", async () => {
  reset();
  stub.projectLimit = { type: "Hours based", cost: 1, resets: "Never", start_date: null };
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 999 * HOUR }),
  );
});

test("a zero or missing duration is a no-op regardless of how tight the limits are", async () => {
  reset();
  stub.daily = 1;
  stub.trackedSeconds["2026-08-25|2026-08-25"] = 5 * HOUR;
  await assert.doesNotReject(() =>
    assertManualTimeEntryWithinLimits(null, { memberId: "m1", projectId: null, date: "2026-08-25", durationSeconds: 0 }),
  );
});
