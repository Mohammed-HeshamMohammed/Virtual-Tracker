// Guards the per_person budget minimum-feasible-end-date math (project-budget-
// fixes follow-up: budget total scaling by headcount + member daily/weekly
// caps constraining how soon a project can finish).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ members: {member_id: string}[], caps: Record<string, {daily?: number, weekly?: number, shifts?: boolean}> }} */
const stub = { members: [], caps: {} };

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  exports: {
    listProjectMembersPg: async () => stub.members,
  },
});

mock.module("../src/modules/tasks/task-workload-validation.js", {
  exports: {
    memberUsesShiftsForLimits: async (_db, memberId) => stub.caps[memberId]?.shifts ?? false,
    getMemberLimitHours: async (_db, memberId, period) =>
      period === "daily" ? stub.caps[memberId]?.daily ?? 0 : stub.caps[memberId]?.weekly ?? 0,
  },
});

const { computeMinimumProjectDays, computeMinimumProjectDaysPg, computeMinimumEndDate } = await import(
  "../src/modules/projects/services/project-budget-capacity.js"
);

test("computeMinimumProjectDays: user's example - 8h per person, 1h/day cap -> 8 days", () => {
  assert.equal(computeMinimumProjectDays([1, 1], 8), 8);
});

test("computeMinimumProjectDays: the tighter (smaller) cap sets the floor, headcount is irrelevant", () => {
  // Second member's looser 4h/day cap never binds - the 1h/day member is still the bottleneck.
  assert.equal(computeMinimumProjectDays([1, 4], 8), 8);
});

test("computeMinimumProjectDays: no capped members means no floor at all", () => {
  assert.equal(computeMinimumProjectDays([0, 0], 8), 0);
});

test("computeMinimumProjectDays: uncapped members mixed with capped ones are ignored, not zero-floor", () => {
  assert.equal(computeMinimumProjectDays([0, 2], 10), 5);
});

test("computeMinimumProjectDays: fractional days round up (can't finish mid-day)", () => {
  assert.equal(computeMinimumProjectDays([3], 8), 3); // ceil(8/3) = 3
});

test("computeMinimumProjectDays: zero or negative hoursPerPerson has no floor", () => {
  assert.equal(computeMinimumProjectDays([1, 2], 0), 0);
});

test("computeMinimumProjectDaysPg: weekly-only cap converts to hours/7 per day", async () => {
  stub.members = [{ member_id: "m1" }];
  stub.caps = { m1: { weekly: 7 } }; // 1h/day effective
  const { minDays, governingMemberId } = await computeMinimumProjectDaysPg(null, "p1", 8);
  assert.equal(minDays, 8);
  assert.equal(governingMemberId, "m1");
});

test("computeMinimumProjectDaysPg: daily cap takes precedence over weekly", async () => {
  stub.members = [{ member_id: "m1" }];
  stub.caps = { m1: { daily: 4, weekly: 7 } }; // daily wins -> 4h/day, not 1h/day
  const { minDays } = await computeMinimumProjectDaysPg(null, "p1", 8);
  assert.equal(minDays, 2); // ceil(8/4)
});

test("computeMinimumProjectDaysPg: shift-based members are uncapped", async () => {
  stub.members = [{ member_id: "m1" }];
  stub.caps = { m1: { daily: 1, shifts: true } };
  const { minDays } = await computeMinimumProjectDaysPg(null, "p1", 8);
  assert.equal(minDays, 0);
});

test("computeMinimumProjectDaysPg: slowest capped member across the whole team governs", async () => {
  stub.members = [{ member_id: "fast" }, { member_id: "slow" }];
  stub.caps = { fast: { daily: 8 }, slow: { daily: 1 } };
  const { minDays, governingMemberId } = await computeMinimumProjectDaysPg(null, "p1", 8);
  assert.equal(minDays, 8);
  assert.equal(governingMemberId, "slow");
});

test("computeMinimumEndDate: anchors to calendar day, not exact creation timestamp", () => {
  const min = computeMinimumEndDate("2026-07-30T23:59:00Z", 8);
  assert.equal(min.toISOString().slice(0, 10), "2026-08-07");
});
