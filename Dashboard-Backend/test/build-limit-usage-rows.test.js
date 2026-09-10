// The limits reports used to sum every day in the selected range and compare
// that single total against one period's limit. These pin the bucketing that
// replaced it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLimitUsageRows,
  summarizeLimitUsage,
  weekStart,
} from "../src/modules/reports/build-limit-usage-rows.js";

const HOUR = 3600;

function usage(day, hours, memberId = "m1") {
  return { memberId, day, activeSeconds: hours * HOUR };
}

const LIMITS = [{ memberId: "m1", weeklyLimitHours: 40, dailyLimitHours: 8 }];

test("weeks run Monday to Sunday", () => {
  // 2026-09-10 is a Thursday; 2026-09-13 is the Sunday that closes that week.
  assert.equal(weekStart("2026-09-10"), "2026-09-07");
  assert.equal(weekStart("2026-09-13"), "2026-09-07");
  assert.equal(weekStart("2026-09-14"), "2026-09-14");
});

// The bug in one test: a month of tracked time compared against a weekly limit.
test("a month-long range produces one row per week, not one total", () => {
  const usageRows = [
    usage("2026-09-07", 8), usage("2026-09-08", 8), usage("2026-09-09", 8),
    usage("2026-09-14", 8), usage("2026-09-15", 8),
    usage("2026-09-21", 9), usage("2026-09-22", 9), usage("2026-09-23", 9),
    usage("2026-09-24", 9), usage("2026-09-25", 9),
  ];
  const rows = buildLimitUsageRows({
    usageRows,
    limitRows: LIMITS,
    kind: "weekly",
    fromDay: "2026-09-07",
    toDay: "2026-09-27",
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => [r.periodStart, r.trackedHours, r.pctUsed]),
    [
      ["2026-09-07", 24, 60],
      ["2026-09-14", 16, 40],
      ["2026-09-21", 45, 113],
    ],
  );
  // The old code would have reported 85 hours against a 40-hour limit as a
  // flat "100%" for the whole month and shown no week at all.
});

test("going over the limit is reported honestly rather than clamped to 100%", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 12)],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-10",
  });
  assert.equal(rows[0].pctUsed, 150);
  assert.equal(rows[0].overLimit, true);
});

test("daily buckets are one row per day worked", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 6), usage("2026-09-11", 9)],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-11",
  });
  assert.deepEqual(
    rows.map((r) => [r.periodStart, r.periodEnd, r.pctUsed, r.overLimit]),
    [
      ["2026-09-10", "2026-09-10", 75, false],
      ["2026-09-11", "2026-09-11", 113, true],
    ],
  );
});

// A half-week's hours against a full week's limit reads as compliance that
// hasn't been earned, so the row says it is only part of a week.
test("a week clipped by the range is flagged partial", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 8)],
    limitRows: LIMITS,
    kind: "weekly",
    fromDay: "2026-09-10",
    toDay: "2026-09-11",
  });
  assert.equal(rows[0].partial, true);
});

test("a whole week inside the range is not partial", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 8)],
    limitRows: LIMITS,
    kind: "weekly",
    fromDay: "2026-09-01",
    toDay: "2026-09-30",
  });
  assert.equal(rows[0].partial, false);
});

test("a member with no configured limit reports hours but no percentage", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 8, "m2")],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-10",
  });
  assert.equal(rows[0].limitHours, 0);
  assert.equal(rows[0].pctUsed, 0);
  assert.equal(rows[0].overLimit, false);
});

test("days with no tracked time do not become zero-percent rows", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 0), usage("2026-09-11", 4)],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-11",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].periodStart, "2026-09-11");
});

test("the per-member summary counts how many periods broke the limit", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 9), usage("2026-09-11", 4), usage("2026-09-12", 10)],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-12",
  });
  const [summary] = summarizeLimitUsage(rows);
  assert.equal(summary.periods, 3);
  assert.equal(summary.periodsOverLimit, 2);
  assert.equal(summary.totalTrackedHours, 23);
  assert.equal(summary.peakPctUsed, 125);
});

test("members are kept apart", () => {
  const rows = buildLimitUsageRows({
    usageRows: [usage("2026-09-10", 5, "m1"), usage("2026-09-10", 6, "m2")],
    limitRows: LIMITS,
    kind: "daily",
    fromDay: "2026-09-10",
    toDay: "2026-09-10",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(summarizeLimitUsage(rows).map((s) => s.memberId), ["m1", "m2"]);
});
