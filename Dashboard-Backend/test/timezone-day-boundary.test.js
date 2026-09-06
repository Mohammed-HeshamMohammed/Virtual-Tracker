// Guards the agreed day-boundary model:
//
//   1. A session's hours belong to the day it STARTED - all of them, however
//      far past midnight it runs. Reports used to prorate a session across
//      every local midnight it crossed, while limit enforcement booked the
//      whole thing to the start day, so one shift was counted two different
//      ways depending on who was asking.
//   2. "Which day" is resolved in the MEMBER's timezone, not the server's.
//
// Together these mean a night shift that finishes inside a rest day still
// books its hours to the working day it started on, and the rest day records
// nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeAndActivityReportPayload } from "../src/modules/reports/build-time-and-activity-rows.js";
import {
  addLocalDays,
  canonicalizeTimeZone,
  localDayFor,
  weekdayIndexForLocalDay,
} from "../src/lib/time/timezone-utils.js";

const memberNameMap = new Map([["m1", { name: "Ada Lovelace" }]]);
const cairo = new Map([["m1", "Africa/Cairo"]]);

// Cairo runs UTC+3 in September, so 17:00Z is 20:00 local on the 5th.
function nightShift(overrides) {
  return {
    member_id: "m1",
    project_id: "p1",
    project_name: "Project One",
    client_name: "Acme Co",
    team_name: "Core Team",
    started_at: "2026-09-05T17:00:00.000Z",
    ended_at: "2026-09-06T10:00:00.000Z",
    updated_at: "2026-09-06T10:00:00.000Z",
    active_seconds: 28800,
    idle_seconds: 1200,
    ...overrides,
  };
}

test("a shift starting 8pm books entirely to its start day, even though it ends the next afternoon", () => {
  const { entries } = buildTimeAndActivityReportPayload(
    [nightShift()],
    memberNameMap,
    cairo,
    "2026-09-01",
    "2026-09-30",
  );

  assert.equal(entries.length, 1, "one shift is one entry - not split across two days");
  assert.equal(entries[0].date, "2026-09-05");
  assert.equal(entries[0].activeSeconds, 28800, "the full amount, not a prorated fraction");
  assert.equal(entries[0].idleSeconds, 1200);
});

test("the end time does not change attribution - ending 1pm or 2pm both land on the start day", () => {
  const endsAt1pm = buildTimeAndActivityReportPayload(
    [nightShift({ ended_at: "2026-09-06T10:00:00.000Z", updated_at: "2026-09-06T10:00:00.000Z" })],
    memberNameMap, cairo, "2026-09-01", "2026-09-30",
  );
  const endsAt2pm = buildTimeAndActivityReportPayload(
    [nightShift({ ended_at: "2026-09-06T11:00:00.000Z", updated_at: "2026-09-06T11:00:00.000Z" })],
    memberNameMap, cairo, "2026-09-01", "2026-09-30",
  );

  assert.equal(endsAt1pm.entries[0].date, "2026-09-05");
  assert.equal(endsAt2pm.entries[0].date, "2026-09-05");
  assert.equal(endsAt1pm.entries[0].activeSeconds, endsAt2pm.entries[0].activeSeconds);
});

test("the day the shift spilled into records nothing at all", () => {
  const { entries } = buildTimeAndActivityReportPayload(
    [nightShift()],
    memberNameMap,
    cairo,
    "2026-09-01",
    "2026-09-30",
  );

  // This is the property that keeps a shift ending inside a weekend from
  // showing stray hours on a day nobody was scheduled to work.
  assert.equal(entries.filter((e) => e.date === "2026-09-06").length, 0);
});

test("the start day is the member's local day, not the server's", () => {
  // 22:00Z on the 5th is already 01:00 on the 6th in Cairo. A server booking
  // this by its own UTC clock would file it under the 5th; the member lived
  // it on the 6th.
  const afterLocalMidnight = nightShift({
    started_at: "2026-09-05T22:00:00.000Z",
    ended_at: "2026-09-06T02:00:00.000Z",
    updated_at: "2026-09-06T02:00:00.000Z",
  });

  const { entries } = buildTimeAndActivityReportPayload(
    [afterLocalMidnight], memberNameMap, cairo, "2026-09-01", "2026-09-30",
  );
  assert.equal(entries[0].date, "2026-09-06");

  const sameSessionInUtc = buildTimeAndActivityReportPayload(
    [afterLocalMidnight], memberNameMap, new Map([["m1", "UTC"]]), "2026-09-01", "2026-09-30",
  );
  assert.equal(sameSessionInUtc.entries[0].date, "2026-09-05", "same instant, different calendar");
});

test("localDayFor: the same instant is a different day depending on the zone", () => {
  const instant = new Date("2026-09-05T22:00:00.000Z");
  assert.equal(localDayFor(instant, "UTC"), "2026-09-05");
  assert.equal(localDayFor(instant, "Africa/Cairo"), "2026-09-06");
  assert.equal(localDayFor(instant, "America/New_York"), "2026-09-05");
});

test("non-whole-hour offsets roll the day over correctly", () => {
  const instant = new Date("2026-09-05T19:00:00.000Z");
  assert.equal(localDayFor(instant, "Asia/Kolkata"), "2026-09-06", "+05:30");
  assert.equal(localDayFor(instant, "Asia/Kathmandu"), "2026-09-06", "+05:45");
  assert.equal(localDayFor(instant, "UTC"), "2026-09-05");
});

test("a legacy IANA alias keeps its real rules instead of silently becoming UTC", () => {
  const instant = new Date("2026-09-05T19:00:00.000Z");
  const viaAlias = localDayFor(instant, canonicalizeTimeZone("Asia/Calcutta"));

  assert.equal(viaAlias, localDayFor(instant, "Asia/Kolkata"), "alias must behave like its canonical zone");
  assert.notEqual(viaAlias, localDayFor(instant, "UTC"), "and must not degrade to UTC");
});

test("an unusable timezone falls back to UTC rather than throwing", () => {
  assert.equal(canonicalizeTimeZone(""), "UTC");
  assert.equal(canonicalizeTimeZone(null), "UTC");
  assert.equal(canonicalizeTimeZone("Not/AZone"), "UTC");
});

test("weekday index is Monday=0, matching how work_days/makeup_days are stored", () => {
  assert.equal(weekdayIndexForLocalDay("2026-09-07"), 0, "Monday");
  assert.equal(weekdayIndexForLocalDay("2026-09-11"), 4, "Friday");
  assert.equal(weekdayIndexForLocalDay("2026-09-12"), 5, "Saturday");
  assert.equal(weekdayIndexForLocalDay("2026-09-13"), 6, "Sunday");
});

test("week start walks back to Monday by calendar days, so a DST week is still 7 days", () => {
  assert.equal(addLocalDays("2026-09-05", -weekdayIndexForLocalDay("2026-09-05")), "2026-08-31");
  // Cairo springs forward in late April; adding days must stay calendar math,
  // not 7 * 86400 seconds, or the week silently shifts by an hour and can
  // land on the wrong date.
  assert.equal(addLocalDays("2026-04-24", 7), "2026-05-01");
  assert.equal(addLocalDays("2026-03-01", -1), "2026-02-28");
});
