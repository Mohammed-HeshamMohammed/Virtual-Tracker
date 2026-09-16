// The agent's "Your week" chart used to read the general dashboard's
// weeklyActivity, which summed whole sessions onto the day they started and
// rounded to tenths of an hour - so it disagreed with the Today/This week
// cards, and anything under ~3 minutes read as nothing. It now reads these
// days, built from the same rollup those cards sum.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWeekDays } from "../src/modules/activity/week-days.js";

test("always seven days, Monday first, dated from the week start", () => {
  const days = buildWeekDays("2026-09-14", [], []);
  assert.deepEqual(
    days.map((d) => [d.day, d.label]),
    [
      ["2026-09-14", "Mon"],
      ["2026-09-15", "Tue"],
      ["2026-09-16", "Wed"],
      ["2026-09-17", "Thu"],
      ["2026-09-18", "Fri"],
      ["2026-09-19", "Sat"],
      ["2026-09-20", "Sun"],
    ],
  );
  assert.ok(days.every((d) => d.activeSeconds === 0 && d.idleSeconds === 0));
});

test("active and idle land on their own day, to the second", () => {
  const days = buildWeekDays(
    "2026-09-14",
    [
      { day: "2026-09-14", active_seconds: "424" },
      { day: "2026-09-16", active_seconds: 95 },
    ],
    [{ day: "2026-09-16", idle_seconds: "12" }],
  );
  assert.equal(days[0].activeSeconds, 424, "pg returns BIGINT sums as strings");
  assert.equal(days[1].activeSeconds, 0);
  assert.equal(days[2].activeSeconds, 95, "a minute and a half is not rounded away");
  assert.equal(days[2].idleSeconds, 12);
});

test("the week's active total is exactly what the rollup holds for those days", () => {
  const rows = [
    { day: "2026-09-14", active_seconds: 3600 },
    { day: "2026-09-15", active_seconds: 1800 },
    { day: "2026-09-13", active_seconds: 9999 }, // previous week - not ours
  ];
  const days = buildWeekDays("2026-09-14", rows, []);
  assert.equal(
    days.reduce((sum, d) => sum + d.activeSeconds, 0),
    5400,
  );
});

test("a week crossing a DST change still has seven distinct calendar days", () => {
  // Europe's clocks go back on 2026-10-25, the Sunday of this week.
  const days = buildWeekDays("2026-10-19", [], []);
  assert.equal(new Set(days.map((d) => d.day)).size, 7);
  assert.equal(days[6].day, "2026-10-25");
});

test("junk values read as zero rather than NaN", () => {
  const days = buildWeekDays("2026-09-14", [{ day: "2026-09-14", active_seconds: null }], [
    { day: "2026-09-14", idle_seconds: "abc" },
  ]);
  assert.equal(days[0].activeSeconds, 0);
  assert.equal(days[0].idleSeconds, 0);
});
