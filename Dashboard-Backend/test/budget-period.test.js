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
