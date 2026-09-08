// Guards startOfDay/getRollingWeekDays now being real per-viewer timezone
// math instead of the process's own local clock (effectively UTC, since the
// container sets no TZ). Command Center and the general dashboard both
// resolve the viewer's own timezone and pass it through these - if these two
// functions regress to ignoring it, "today"/"this week" on someone's own
// dashboard silently goes back to being the server's day, not theirs.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfDay, getRollingWeekDays } from "../src/modules/dashboard/dashboard-utils.js";
import { localDayFor } from "../src/lib/time/timezone-utils.js";

test("startOfDay with no timezone matches the old UTC-only behaviour", () => {
  const d = startOfDay(new Date("2026-09-05T15:30:00.000Z"));
  assert.equal(d.toISOString(), "2026-09-05T00:00:00.000Z");
});

test("startOfDay in a real viewer's timezone can land on a different calendar day than UTC", () => {
  // 22:00 UTC on the 5th is already 01:00 on the 6th in Cairo (UTC+3).
  const instant = new Date("2026-09-05T22:00:00.000Z");
  const utcMidnight = startOfDay(instant, "UTC");
  const cairoMidnight = startOfDay(instant, "Africa/Cairo");

  assert.equal(utcMidnight.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(cairoMidnight.toISOString(), "2026-09-05T21:00:00.000Z", "Cairo midnight on the 6th, in UTC terms");
  assert.notEqual(utcMidnight.getTime(), cairoMidnight.getTime());
});

test("getRollingWeekDays returns 7 real UTC instants, keyed by the correct local date", () => {
  const days = getRollingWeekDays("UTC");
  assert.equal(days.length, 7);
  assert.equal(days[0].key, "mon");
  assert.equal(days[6].key, "sun");
  for (const day of days) {
    // Each day's own boundaries must actually contain "now" in that day's
    // own local midnight framing - i.e. startMs < endMs and they span exactly
    // one day, not an off-by-one from a UTC-vs-local mismatch.
    assert.equal(day.endMs - day.startMs, 86_400_000 - 1);
    assert.equal(new Date(day.startMs).toISOString().slice(0, 10), day.dateKey);
  }
});

test("getRollingWeekDays in a viewer's own zone can disagree with the UTC week about which week 'today' is in", () => {
  // Deliberately not stubbing "now" - the point is this must hold for real
  // wall-clock time, not just a fixed fixture instant. Assert the structural
  // property instead: the member's own week always contains their own local
  // "today", which the UTC week is not guaranteed to.
  const cairoDays = getRollingWeekDays("Africa/Cairo");
  const todayCairo = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  assert.ok(
    cairoDays.some((d) => d.dateKey === todayCairo),
    "the viewer's own rolling week must contain the viewer's own today",
  );
});

test("a shift landing in one viewer's week can fall outside another viewer's week near a week boundary", () => {
  // Sunday 23:00 UTC is already Monday in Cairo (UTC+3, or +2 outside DST -
  // either way it rolls over) - a new week has started there while it's
  // still the old week in UTC.
  //
  // Read the local day with localDayFor, not by re-deriving a date string
  // from startOfDay()'s returned instant - that instant is anchored to that
  // zone's midnight in UTC terms (e.g. 21:00 UTC for Cairo), so calling
  // .toISOString() on it and slicing the date back off would silently read
  // the wrong day again. That mistake is exactly the class of bug this
  // change exists to fix; asserting it correctly means not repeating it here.
  const instant = new Date("2026-08-30T23:00:00.000Z"); // a Sunday, UTC
  const utcDay = localDayFor(instant, "UTC");
  const cairoDay = localDayFor(instant, "Africa/Cairo");
  assert.notEqual(utcDay, cairoDay, "precondition: this instant really does straddle a local day boundary");
  assert.equal(utcDay, "2026-08-30");
  assert.equal(cairoDay, "2026-08-31");
});
