// The schedule due-check used to be elapsed-milliseconds arithmetic against
// last_sent_at: "Monthly" meant 30 days, "Weekly" had no weekday anchor, and
// an hour of tolerance let each send creep earlier than the last. These guard
// the calendar behaviour that replaced it.
import test from "node:test";
import assert from "node:assert/strict";
import { isReportScheduleDue, lastScheduledOccurrence } from "../src/modules/reports/date-range-kind.js";

function at(iso) {
  return new Date(iso);
}

function schedule(overrides = {}) {
  return {
    frequency: "Weekly",
    delivery_time: "08:30:00",
    // A Thursday.
    created_at: "2026-09-10T08:30:00.000Z",
    last_sent_at: null,
    ...overrides,
  };
}

test("weekly occurrences keep the anchor's weekday", () => {
  // 2026-09-10 is a Thursday.
  assert.equal(lastScheduledOccurrence("Weekly", "2026-09-10", "2026-09-10"), "2026-09-10");
  assert.equal(lastScheduledOccurrence("Weekly", "2026-09-10", "2026-09-16"), "2026-09-10");
  assert.equal(lastScheduledOccurrence("Weekly", "2026-09-10", "2026-09-17"), "2026-09-17");
  assert.equal(lastScheduledOccurrence("Weekly", "2026-09-10", "2026-10-01"), "2026-10-01");
});

test("bi-weekly occurrences land every fourteenth day, never on the off week", () => {
  assert.equal(lastScheduledOccurrence("Bi-weekly", "2026-09-10", "2026-09-17"), "2026-09-10");
  assert.equal(lastScheduledOccurrence("Bi-weekly", "2026-09-10", "2026-09-24"), "2026-09-24");
});

test("daily occurrences are simply today", () => {
  assert.equal(lastScheduledOccurrence("Daily", "2026-09-10", "2026-11-02"), "2026-11-02");
});

// The old 30-day interval walked a month-end schedule backwards through the
// calendar: Jan 31 -> Mar 2 -> Apr 1, never the same date twice.
test("monthly keeps its day of the month across a whole year", () => {
  const days = [];
  for (const today of [
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31",
  ]) {
    days.push(lastScheduledOccurrence("Monthly", "2026-01-31", today));
  }
  assert.deepEqual(days, [
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31",
  ]);
});

test("a monthly anchor past the end of a short month clamps rather than skipping it", () => {
  // February 2028 is a leap year: the 31st clamps to the 29th, not the 28th.
  assert.equal(lastScheduledOccurrence("Monthly", "2026-01-31", "2028-02-29"), "2028-02-29");
});

test("nothing is due before the schedule's first occurrence", () => {
  assert.equal(lastScheduledOccurrence("Weekly", "2026-09-10", "2026-09-09"), null);
  assert.equal(isReportScheduleDue(schedule(), "UTC", at("2026-09-09T23:00:00.000Z")), false);
});

test("a schedule is not due before its delivery time", () => {
  assert.equal(isReportScheduleDue(schedule(), "UTC", at("2026-09-10T08:29:00.000Z")), false);
  assert.equal(isReportScheduleDue(schedule(), "UTC", at("2026-09-10T08:31:00.000Z")), true);
});

// The delivery time is read on the member's clock, not the server's.
test("delivery time is evaluated in the member's zone", () => {
  const s = schedule({ created_at: "2026-09-09T00:00:00.000Z", delivery_time: "08:30:00", frequency: "Daily" });
  // 06:00Z is 09:00 in Cairo (UTC+3) - past 08:30 there, well before it in UTC.
  assert.equal(isReportScheduleDue(s, "Africa/Cairo", at("2026-09-10T06:00:00.000Z")), true);
  assert.equal(isReportScheduleDue(s, "UTC", at("2026-09-10T06:00:00.000Z")), false);
});

test("a schedule already sent today is not due again", () => {
  const s = schedule({ frequency: "Daily", last_sent_at: "2026-09-10T08:31:00.000Z" });
  assert.equal(isReportScheduleDue(s, "UTC", at("2026-09-10T20:00:00.000Z")), false);
  assert.equal(isReportScheduleDue(s, "UTC", at("2026-09-11T08:31:00.000Z")), true);
});

// The old check compared elapsed time against the interval, so a delivery
// missed while the server was down was skipped until the next period came
// round. Comparing against the occurrence sends it late instead.
test("a delivery missed while the server was down goes out on the next check", () => {
  // Weekly, anchored Thursday 10 Sep, last sent that day. The 17th's delivery
  // was missed; on the 19th it is still owed.
  const s = schedule({ last_sent_at: "2026-09-10T08:31:00.000Z" });
  assert.equal(isReportScheduleDue(s, "UTC", at("2026-09-19T10:00:00.000Z")), true);
});

test("a weekly schedule does not fire on the days between its occurrences", () => {
  const s = schedule({ last_sent_at: "2026-09-10T08:31:00.000Z" });
  for (const day of ["11", "12", "13", "14", "15", "16"]) {
    assert.equal(
      isReportScheduleDue(s, "UTC", at(`2026-09-${day}T20:00:00.000Z`)),
      false,
      `should not be due on 2026-09-${day}`,
    );
  }
});

test("an unrecognised frequency falls back to weekly rather than firing daily", () => {
  assert.equal(lastScheduledOccurrence("Fortnightly?", "2026-09-10", "2026-09-16"), "2026-09-10");
});
