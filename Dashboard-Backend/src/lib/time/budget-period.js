// Which days a project budget's spend counts over right now.
//
// A budget has a reset period (Never / Weekly / Monthly / At end date), the day it starts on and an
// optional day it ends on. With a reset, periods roll over from the start day - weekly every 7 days, monthly on
// the same day of each month (the 31st falls back to the month's last day) - and only the current
// period counts. "At end date" repeats the start..end window itself: when the end day passes, the
// budget starts over for another period of the same length (it needs both days; without both it
// behaves like Never). "When used up" starts over the day after the budget has been used up (spend
// reaching the budget total), however soon that is; it needs the day-by-day spend, which only the
// database layer has, so here it takes `dailySpend` (day -> amount in the budget's own unit) and
// without it counts everything like Never. Without a reset, everything from the start day to the
// end day counts.
//
// Days are plain "YYYY-MM-DD" strings of the project's own calendar; `todayDay` is today in it.
// Mirrored for display in Dashboard-Web/features/projects/utils/budget-period.ts.

const DAY_MS = 86_400_000;

function toDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // node-pg hands a DATE back at local midnight: read its local calendar day.
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function parts(day) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

function fmt(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function utc(day) {
  const { y, m, d } = parts(day);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day, n) {
  const t = new Date(utc(day) + n * DAY_MS);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(from, to) {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `anchor` moved by `n` months, keeping its day of month where the month has it. */
export function addMonths(anchor, n) {
  const { y, m, d } = parts(anchor);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function normalizeResets(resets) {
  const key = String(resets ?? "").trim().toLowerCase();
  if (key === "weekly" || key === "monthly") return key;
  if (key === "at end date") return "repeat";
  return key === "when used up" ? "usedup" : "never";
}

/**
 * The window the budget's spend is counted over.
 *
 * @returns {{ resets: "never"|"weekly"|"monthly"|"repeat", fromDay: string|null, toDay: string|null,
 *             periodStart: string|null, periodEnd: string|null, notStarted: boolean, ended: boolean }}
 *   fromDay/toDay are what to sum (inclusive; null = unbounded). periodStart/periodEnd are the
 *   current period for display (periodEnd is the day before the next reset, or the end day).
 */
export function budgetPeriodWindow(
  { resets, start_date, end_date, startDate, endDate, cost } = {},
  todayDay,
  { dailySpend = null } = {},
) {
  const start = toDay(start_date ?? startDate);
  const end = toDay(end_date ?? endDate);
  let kind = normalizeResets(resets);

  if (kind === "usedup") {
    const cap = Number(cost);
    // It needs a start day, a budget total and the daily spend to walk; without them it is Never.
    if (!(start && cap > 0 && dailySpend)) kind = "never";
    else return usedUpWindow({ start, end, cap, dailySpend }, todayDay);
  }
  // "At end date" repeats the window between the two days, so it needs both.
  if (kind === "repeat" && !(start && end && end >= start)) kind = "never";

  if (kind === "repeat") {
    const length = daysBetween(start, end) + 1; // inclusive
    if (todayDay < start) {
      return { resets: kind, fromDay: start, toDay: end, periodStart: start, periodEnd: end, notStarted: true, ended: false };
    }
    const k = Math.floor(daysBetween(start, todayDay) / length);
    const periodStart = addDays(start, k * length);
    const periodEnd = addDays(periodStart, length - 1);
    return { resets: kind, fromDay: periodStart, toDay: periodEnd, periodStart, periodEnd, notStarted: false, ended: false };
  }

  if (kind === "never") {
    return {
      resets: kind,
      fromDay: start,
      toDay: end,
      periodStart: start,
      periodEnd: end,
      notStarted: Boolean(start && todayDay < start),
      ended: Boolean(end && todayDay > end),
    };
  }

  // No start day: periods line up with the calendar (Mondays, the 1st).
  const anchor =
    start ?? (kind === "weekly" ? addDays(todayDay, -((new Date(utc(todayDay)).getUTCDay() + 6) % 7)) : `${todayDay.slice(0, 8)}01`);

  if (todayDay < anchor) {
    const firstEnd = kind === "weekly" ? addDays(anchor, 6) : addDays(addMonths(anchor, 1), -1);
    const periodEnd = end && end < firstEnd ? end : firstEnd;
    return { resets: kind, fromDay: anchor, toDay: periodEnd, periodStart: anchor, periodEnd, notStarted: true, ended: false };
  }

  // Past the end day the budget is over: keep showing the period it ended in.
  const ended = Boolean(end && todayDay > end);
  const ref = ended ? end : todayDay;

  let periodStart;
  let nextStart;
  if (kind === "weekly") {
    const k = Math.floor(daysBetween(anchor, ref) / 7);
    periodStart = addDays(anchor, 7 * k);
    nextStart = addDays(periodStart, 7);
  } else {
    const a = parts(anchor);
    const r = parts(ref);
    let n = (r.y - a.y) * 12 + (r.m - a.m);
    if (addMonths(anchor, n) > ref) n -= 1;
    periodStart = addMonths(anchor, n);
    nextStart = addMonths(anchor, n + 1);
  }
  const naturalEnd = addDays(nextStart, -1);
  const periodEnd = end && end < naturalEnd ? end : naturalEnd;
  return { resets: kind, fromDay: periodStart, toDay: periodEnd, periodStart, periodEnd, notStarted: false, ended };
}

/**
 * "When used up": walk the days from the start, adding each day's spend; when the total reaches the
 * budget at the end of a day, the next period starts the following day with nothing counted. Today
 * is never rolled over - a budget used up today stays full until midnight, so "stop timers when
 * reached" holds for the rest of the day. Spend past the cap on the day it was used up stays in
 * that period (the budget is cut at day boundaries).
 *
 * @param {{ start: string, end: string|null, cap: number, dailySpend: Map<string, number> | Record<string, number> }} input
 */
function usedUpWindow({ start, end, cap, dailySpend }, todayDay) {
  const spendOn = (day) => Number(dailySpend instanceof Map ? dailySpend.get(day) : dailySpend[day]) || 0;
  const ended = Boolean(end && todayDay > end);
  const last = ended ? end : todayDay;

  if (todayDay < start) {
    return { resets: "usedup", fromDay: start, toDay: end, periodStart: start, periodEnd: end, notStarted: true, ended: false };
  }

  let periodStart = start;
  let total = 0;
  let periods = 1;
  for (let day = start; day < last; day = addDays(day, 1)) {
    total += spendOn(day);
    if (total >= cap) {
      periodStart = addDays(day, 1);
      total = 0;
      periods += 1;
    }
  }
  return { resets: "usedup", fromDay: periodStart, toDay: end, periodStart, periodEnd: end, notStarted: false, ended, periods };
}
