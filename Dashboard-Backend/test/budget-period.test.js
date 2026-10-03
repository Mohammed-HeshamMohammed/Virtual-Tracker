// A project budget's reset period: only the current period's spend counts.
import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, budgetPeriodWindow } from "../src/lib/time/budget-period.js";

const w = (budget, today) => budgetPeriodWindow(budget, today);

test("Never: everything from the start day to the end day counts, as before", () => {
  assert.deepEqual(
    pick(w({ resets: "Never", start_date: "2026-01-10", end_date: "2026-03-01" }, "2026-02-01")),
    { fromDay: "2026-01-10", toDay: "2026-03-01" },
  );
  assert.deepEqual(pick(w({ resets: "Never" }, "2026-02-01")), { fromDay: null, toDay: null });
  assert.deepEqual(pick(w({ resets: "", start_date: "2026-01-10" }, "2026-02-01")), { fromDay: "2026-01-10", toDay: null });
});

test("Monthly rolls over on the start day's date each month", () => {
  const b = { resets: "Monthly", start_date: "2026-01-15" };
  assert.deepEqual(pick(w(b, "2026-01-15")), { fromDay: "2026-01-15", toDay: "2026-02-14" });
  assert.deepEqual(pick(w(b, "2026-02-14")), { fromDay: "2026-01-15", toDay: "2026-02-14" });
  assert.deepEqual(pick(w(b, "2026-02-15")), { fromDay: "2026-02-15", toDay: "2026-03-14" });
  assert.deepEqual(pick(w(b, "2026-12-31")), { fromDay: "2026-12-15", toDay: "2027-01-14" });
});

test("a monthly start on the 31st falls back to each month's last day, without drifting", () => {
  const b = { resets: "Monthly", start_date: "2026-01-31" };
  assert.deepEqual(pick(w(b, "2026-02-28")), { fromDay: "2026-02-28", toDay: "2026-03-30" });
  assert.deepEqual(pick(w(b, "2026-03-31")), { fromDay: "2026-03-31", toDay: "2026-04-29" });
  assert.deepEqual(pick(w(b, "2026-04-30")), { fromDay: "2026-04-30", toDay: "2026-05-30" });
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29", "leap year");
});

test("Weekly rolls over every 7 days from the start day", () => {
  const b = { resets: "Weekly", start_date: "2026-01-07" }; // a Wednesday
  assert.deepEqual(pick(w(b, "2026-01-07")), { fromDay: "2026-01-07", toDay: "2026-01-13" });
  assert.deepEqual(pick(w(b, "2026-01-13")), { fromDay: "2026-01-07", toDay: "2026-01-13" });
  assert.deepEqual(pick(w(b, "2026-01-14")), { fromDay: "2026-01-14", toDay: "2026-01-20" });
});

test("with no start day, periods line up with the calendar", () => {
  assert.deepEqual(pick(w({ resets: "Monthly" }, "2026-03-18")), { fromDay: "2026-03-01", toDay: "2026-03-31" });
  // 2026-03-18 is a Wednesday; the week starts Monday the 16th.
  assert.deepEqual(pick(w({ resets: "Weekly" }, "2026-03-18")), { fromDay: "2026-03-16", toDay: "2026-03-22" });
});

test("a start day in the future means the first period has not begun", () => {
  const r = w({ resets: "Monthly", start_date: "2026-05-10" }, "2026-04-01");
  assert.equal(r.notStarted, true);
  assert.equal(r.fromDay, "2026-05-10", "nothing before it counts");
});

test("an end day cuts the period short, and after it the budget shows the period it ended in", () => {
  const b = { resets: "Monthly", start_date: "2026-01-15", end_date: "2026-03-01" };
  assert.deepEqual(pick(w(b, "2026-02-20")), { fromDay: "2026-02-15", toDay: "2026-03-01" });
  const after = w(b, "2026-06-01");
  assert.equal(after.ended, true);
  assert.deepEqual(pick(after), { fromDay: "2026-02-15", toDay: "2026-03-01" });
});

test("a Date from the database is read as the calendar day it is", () => {
  const r = w({ resets: "Monthly", start_date: new Date(2026, 0, 15) }, "2026-02-20");
  assert.equal(r.fromDay, "2026-02-15");
});

function pick(r) {
  return { fromDay: r.fromDay, toDay: r.toDay };
}

// "At end date": when the end day passes, the same-length window starts over.
test("At end date repeats the start..end window, inclusive, forever", () => {
  const b = { resets: "At end date", start_date: "2026-01-01", end_date: "2026-01-10" }; // 10 days
  assert.deepEqual(pick(w(b, "2026-01-05")), { fromDay: "2026-01-01", toDay: "2026-01-10" });
  assert.deepEqual(pick(w(b, "2026-01-10")), { fromDay: "2026-01-01", toDay: "2026-01-10" });
  assert.deepEqual(pick(w(b, "2026-01-11")), { fromDay: "2026-01-11", toDay: "2026-01-20" });
  assert.deepEqual(pick(w(b, "2026-03-05")), { fromDay: "2026-03-02", toDay: "2026-03-11" });
  assert.equal(w(b, "2026-03-05").ended, false, "it never ends");
});

test("At end date before the first period begins has not started", () => {
  const r = w({ resets: "At end date", start_date: "2026-05-01", end_date: "2026-05-31" }, "2026-04-10");
  assert.equal(r.notStarted, true);
  assert.deepEqual(pick(r), { fromDay: "2026-05-01", toDay: "2026-05-31" });
});

test("At end date needs both days - without them it behaves like Never", () => {
  assert.deepEqual(pick(w({ resets: "At end date", start_date: "2026-01-01" }, "2026-06-01")), { fromDay: "2026-01-01", toDay: null });
  assert.deepEqual(pick(w({ resets: "At end date", end_date: "2026-01-31" }, "2026-06-01")), { fromDay: null, toDay: "2026-01-31" });
  assert.deepEqual(
    pick(w({ resets: "At end date", start_date: "2026-02-10", end_date: "2026-02-01" }, "2026-06-01")),
    { fromDay: "2026-02-10", toDay: "2026-02-01" },
    "an end before the start is not a window to repeat",
  );
});

test("a one-day window repeats every day", () => {
  const b = { resets: "At end date", start_date: "2026-01-01", end_date: "2026-01-01" };
  assert.deepEqual(pick(w(b, "2026-01-04")), { fromDay: "2026-01-04", toDay: "2026-01-04" });
});

// "When used up": the period restarts the day after the budget is used up.
const usedUp = (spendByDay, today, extra = {}) =>
  budgetPeriodWindow(
    { resets: "When used up", start_date: "2026-01-01", cost: 10, ...extra },
    today,
    { dailySpend: new Map(Object.entries(spendByDay)) },
  );

test("When used up: before the budget is used up, everything since the start counts", () => {
  const r = usedUp({ "2026-01-01": 3, "2026-01-02": 4 }, "2026-01-05");
  assert.equal(r.fromDay, "2026-01-01");
});

test("When used up: the day after it is used up, a new period starts from nothing", () => {
  const spend = { "2026-01-01": 4, "2026-01-02": 6 }; // 10 = used up at the end of Jan 2
  assert.equal(usedUp(spend, "2026-01-03").fromDay, "2026-01-03");
  assert.equal(usedUp(spend, "2026-01-20").fromDay, "2026-01-03");
});

test("When used up: a budget used up TODAY stays full until midnight", () => {
  const spend = { "2026-01-01": 4, "2026-01-02": 6 };
  assert.equal(usedUp(spend, "2026-01-02").fromDay, "2026-01-01", "still the same period today");
});

test("When used up: it can be used up again, and again, sooner each time", () => {
  const spend = { "2026-01-01": 10, "2026-01-02": 10, "2026-01-03": 3, "2026-01-04": 8 };
  // used up end of Jan 1 -> period 2 starts Jan 2; used up end of Jan 2 -> period 3 starts Jan 3;
  // Jan 3 + Jan 4 = 11 -> used up end of Jan 4 -> period 4 starts Jan 5.
  assert.equal(usedUp(spend, "2026-01-05").fromDay, "2026-01-05");
  assert.equal(usedUp(spend, "2026-01-05").periods, 4);
  assert.equal(usedUp(spend, "2026-01-04").fromDay, "2026-01-03");
});

test("When used up: spend over the cap on the day it is used up stays in that period", () => {
  assert.equal(usedUp({ "2026-01-01": 25 }, "2026-01-02").fromDay, "2026-01-02");
  assert.equal(usedUp({ "2026-01-01": 25, "2026-01-02": 1 }, "2026-01-02").fromDay, "2026-01-02");
});

test("When used up: it stops at the end day, and has not begun before the start", () => {
  const ended = usedUp({ "2026-01-01": 10 }, "2026-06-01", { end_date: "2026-01-31" });
  assert.equal(ended.ended, true);
  assert.equal(ended.toDay, "2026-01-31");
  assert.equal(usedUp({}, "2025-12-01").notStarted, true);
});

test("When used up needs a start day, a budget total and the daily spend - otherwise it is Never", () => {
  const never = (budget, opts) => pick(budgetPeriodWindow(budget, "2026-06-01", opts));
  assert.deepEqual(never({ resets: "When used up", cost: 10 }, { dailySpend: new Map() }), { fromDay: null, toDay: null });
  assert.deepEqual(never({ resets: "When used up", start_date: "2026-01-01", cost: 0 }, { dailySpend: new Map() }), { fromDay: "2026-01-01", toDay: null });
  assert.deepEqual(never({ resets: "When used up", start_date: "2026-01-01", cost: 10 }), { fromDay: "2026-01-01", toDay: null });
});
