// resolvePayPeriodBounds backs "what period am I submitting" on the
// Timesheets page - previously hardcoded to a Monday-Sunday week regardless
// of the member's own configured pay_rates.pay_period.
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePayPeriodBounds } from "../src/modules/timesheets/pay-period-bounds.js";

test("weekly: Monday-Sunday containing the reference date", () => {
  // Wednesday 2026-09-02
  const { start, end } = resolvePayPeriodBounds("weekly", new Date("2026-09-02T12:00:00.000Z"));
  assert.equal(start, "2026-08-31"); // Monday
  assert.equal(end, "2026-09-06"); // Sunday
});

test("weekly: a Sunday belongs to the week that started the Monday before it", () => {
  const { start, end } = resolvePayPeriodBounds("weekly", new Date("2026-09-06T12:00:00.000Z"));
  assert.equal(start, "2026-08-31");
  assert.equal(end, "2026-09-06");
});

test("none falls back to weekly - no cadence configured, week is the least surprising default", () => {
  const a = resolvePayPeriodBounds("none", new Date("2026-09-02T12:00:00.000Z"));
  const b = resolvePayPeriodBounds("weekly", new Date("2026-09-02T12:00:00.000Z"));
  assert.deepEqual(a, b);
});

test("an unrecognized pay_period value also falls back to weekly", () => {
  const a = resolvePayPeriodBounds("garbage", new Date("2026-09-02T12:00:00.000Z"));
  const b = resolvePayPeriodBounds("weekly", new Date("2026-09-02T12:00:00.000Z"));
  assert.deepEqual(a, b);
});

test("twice-per-month: day 1-15 lands in the first half", () => {
  const { start, end } = resolvePayPeriodBounds("twice-per-month", new Date("2026-09-10T12:00:00.000Z"));
  assert.equal(start, "2026-09-01");
  assert.equal(end, "2026-09-15");
});

test("twice-per-month: day 16-end lands in the second half, end-of-month correct for a 30-day month", () => {
  const { start, end } = resolvePayPeriodBounds("twice-per-month", new Date("2026-09-20T12:00:00.000Z"));
  assert.equal(start, "2026-09-16");
  assert.equal(end, "2026-09-30");
});

test("twice-per-month: second half handles February correctly (28-day month)", () => {
  const { start, end } = resolvePayPeriodBounds("twice-per-month", new Date("2026-02-20T12:00:00.000Z"));
  assert.equal(start, "2026-02-16");
  assert.equal(end, "2026-02-28");
});

test("monthly: full calendar month containing the reference date", () => {
  const { start, end } = resolvePayPeriodBounds("monthly", new Date("2026-09-15T12:00:00.000Z"));
  assert.equal(start, "2026-09-01");
  assert.equal(end, "2026-09-30");
});

test("bi-weekly: a 14-day block, and the reference date always falls inside its own returned range", () => {
  const { start, end } = resolvePayPeriodBounds("bi-weekly", new Date("2026-09-02T12:00:00.000Z"));
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  const refMs = new Date("2026-09-02T00:00:00.000Z").getTime();
  assert.equal((endMs - startMs) / 86_400_000, 13, "a 14-day block spans 13 days start to end");
  assert.ok(refMs >= startMs && refMs <= endMs, "the reference date must fall inside its own block");
});

test("bi-weekly: the day right after a block ends starts the next block", () => {
  const first = resolvePayPeriodBounds("bi-weekly", new Date("2026-01-05T12:00:00.000Z"));
  const dayAfter = new Date(`${first.end}T00:00:00.000Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const second = resolvePayPeriodBounds("bi-weekly", dayAfter);
  assert.equal(second.start, dayAfter.toISOString().slice(0, 10));
});

test("case-insensitive: pay_rates stores 'None' capitalized, still resolves like weekly", () => {
  const a = resolvePayPeriodBounds("None", new Date("2026-09-02T12:00:00.000Z"));
  const b = resolvePayPeriodBounds("weekly", new Date("2026-09-02T12:00:00.000Z"));
  assert.deepEqual(a, b);
});
