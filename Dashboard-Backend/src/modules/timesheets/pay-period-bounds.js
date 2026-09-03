// Resolves a member's own configured pay_rates.pay_period into a concrete
// [start, end] date range containing a reference date - what "your current
// timesheet period" actually means, instead of the frontend hardcoding a
// Monday-Sunday week regardless of what the member (or org) is set up as.
//
// All dates are plain 'YYYY-MM-DD' calendar days, resolved in UTC-as-a-
// calendar-scratchpad the same way date-range-kind.js's resolveDateRangeKind
// already does for report ranges - this is a distinct concept (a payroll
// cadence, not a report lookback window) so it gets its own resolver rather
// than overloading that one.

const DAY_MS = 24 * 60 * 60 * 1000;

function toDayStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Monday-Sunday week containing `day`. */
function weekBounds(day) {
  const dow = day.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDays(day, diffToMonday);
  return { start: toDayStr(monday), end: toDayStr(addDays(monday, 6)) };
}

/**
 * Bi-weekly has no natural calendar anchor the way a week or month does, so
 * every member's 14-day block is aligned to the same fixed org-wide grid
 * (an arbitrary but fixed Monday: 2020-01-06) rather than drifting per
 * member. A per-member anchor (e.g. their pay_rates.effective_date) would
 * be more precise but isn't tracked as a payroll-cycle anchor anywhere
 * today - this is the same "single fixed grid" approach client budget
 * resets use elsewhere in this codebase.
 */
function biWeeklyBounds(day) {
  const anchor = new Date("2020-01-06T00:00:00.000Z");
  const daysSinceAnchor = Math.floor((day.getTime() - anchor.getTime()) / DAY_MS);
  const blockIndex = Math.floor(daysSinceAnchor / 14);
  const start = addDays(anchor, blockIndex * 14);
  return { start: toDayStr(start), end: toDayStr(addDays(start, 13)) };
}

/** 1st-15th, 16th-end of month - the standard semi-monthly split. */
function twicePerMonthBounds(day) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (day.getUTCDate() <= 15) {
    return { start: toDayStr(new Date(Date.UTC(y, m, 1))), end: toDayStr(new Date(Date.UTC(y, m, 15))) };
  }
  return { start: toDayStr(new Date(Date.UTC(y, m, 16))), end: toDayStr(new Date(Date.UTC(y, m, lastDay))) };
}

function monthBounds(day) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { start: toDayStr(new Date(Date.UTC(y, m, 1))), end: toDayStr(new Date(Date.UTC(y, m, lastDay))) };
}

/**
 * @param {string} payPeriod one of PAY_PERIODS ("weekly" | "none" |
 *   "twice-per-month" | "bi-weekly" | "monthly") - case-insensitive, "none"
 *   or anything unrecognized falls back to weekly (there's no cadence to
 *   anchor on, and a week is the least surprising default view).
 * @param {Date} [referenceDate]
 * @returns {{ start: string, end: string }}
 */
export function resolvePayPeriodBounds(payPeriod, referenceDate = new Date()) {
  const today = new Date(
    `${referenceDate.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  switch (String(payPeriod || "").toLowerCase()) {
    case "bi-weekly":
      return biWeeklyBounds(today);
    case "twice-per-month":
      return twicePerMonthBounds(today);
    case "monthly":
      return monthBounds(today);
    case "weekly":
    case "none":
    default:
      return weekBounds(today);
  }
}
