// Which days a project budget's spend counts over right now.
//
// A budget has a reset period (Never / Weekly / Monthly), the day it starts on and an optional day
// it ends on. With a reset, periods roll over from the start day - weekly every 7 days, monthly on
// the same day of each month (the 31st falls back to the month's last day) - and only the current
// period counts. Without one, everything from the start day to the end day counts, as before.
//
// Days are plain "YYYY-MM-DD" strings of the project's own calendar; `todayDay` is today in it.
// The backend's copy (Dashboard-Backend/src/lib/time/budget-period.js) decides what is counted;
// this one only shows the same period in the project form.

const DAY_MS = 86_400_000;

function toDay(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // node-pg hands a DATE back at local midnight: read its local calendar day.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function utc(day: string) {
  const { y, m, d } = parts(day);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const t = new Date(utc(day) + n * DAY_MS);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function daysBetween(from: string, to: string) {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `anchor` moved by `n` months, keeping its day of month where the month has it. */
export function addMonths(anchor: string, n: number): string {
  const { y, m, d } = parts(anchor);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function normalizeResets(resets: unknown): "never" | "weekly" | "monthly" {
  const key = String(resets ?? "").trim().toLowerCase();
  return key === "weekly" || key === "monthly" ? key : "never";
}

export type BudgetPeriod = {
  resets: "never" | "weekly" | "monthly"
  fromDay: string | null
  toDay: string | null
  periodStart: string | null
  periodEnd: string | null
  notStarted: boolean
  ended: boolean
}

/** The window the budget's spend is counted over (fromDay/toDay inclusive; null = unbounded). */
export function budgetPeriodWindow(
  {
    resets,
    start_date,
    end_date,
    startDate,
    endDate,
  }: { resets?: unknown; start_date?: unknown; end_date?: unknown; startDate?: unknown; endDate?: unknown } = {},
  todayDay: string,
): BudgetPeriod {
  const start = toDay(start_date ?? startDate);
  const end = toDay(end_date ?? endDate);
  const kind = normalizeResets(resets);

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
  const ref: string = ended && end ? end : todayDay;

  let periodStart: string
  let nextStart: string
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
