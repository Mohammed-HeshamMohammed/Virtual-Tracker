import { localDayFor } from "./timezone-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateParam(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

export function resolveDateRangeKind(label, timeZone, now = new Date()) {
  const today = new Date(`${localDayFor(now, timeZone)}T00:00:00.000Z`);

  switch (label) {
    case "Today":
      return { from: toDateParam(today), to: toDateParam(today) };
    case "Yesterday": {
      const y = addDays(today, -1);
      return { from: toDateParam(y), to: toDateParam(y) };
    }
    case "This week": {
      const dow = today.getUTCDay();
      const diffToMonday = dow === 0 ? -6 : 1 - dow;
      const monday = addDays(today, diffToMonday);
      return { from: toDateParam(monday), to: toDateParam(today) };
    }
    case "Last week": {
      const dow = today.getUTCDay();
      const diffToMonday = dow === 0 ? -6 : 1 - dow;
      const thisMonday = addDays(today, diffToMonday);
      const lastMonday = addDays(thisMonday, -7);
      const lastSunday = addDays(lastMonday, 6);
      return { from: toDateParam(lastMonday), to: toDateParam(lastSunday) };
    }
    case "The last 2 weeks":
      return { from: toDateParam(addDays(today, -13)), to: toDateParam(today) };
    case "This month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from: toDateParam(first), to: toDateParam(today) };
    }
    case "Last month": {
      const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const lastPrevMonth = addDays(firstThis, -1);
      const firstPrevMonth = new Date(Date.UTC(lastPrevMonth.getUTCFullYear(), lastPrevMonth.getUTCMonth(), 1));
      return { from: toDateParam(firstPrevMonth), to: toDateParam(lastPrevMonth) };
    }
    case "This quarter": {
      const qStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      const first = new Date(Date.UTC(today.getUTCFullYear(), qStartMonth, 1));
      return { from: toDateParam(first), to: toDateParam(today) };
    }
    case "Last quarter": {
      const qStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      const firstThisQ = new Date(Date.UTC(today.getUTCFullYear(), qStartMonth, 1));
      const lastPrevQ = addDays(firstThisQ, -1);
      const firstPrevQ = new Date(Date.UTC(lastPrevQ.getUTCFullYear(), Math.floor(lastPrevQ.getUTCMonth() / 3) * 3, 1));
      return { from: toDateParam(firstPrevQ), to: toDateParam(lastPrevQ) };
    }
    case "The last 7 days":
    default:
      return { from: toDateParam(addDays(today, -6)), to: toDateParam(today) };
  }
}

/**
 * When a schedule is next owed a delivery.
 *
 * The old test was elapsed-milliseconds arithmetic against `last_sent_at`, and
 * it drifted in three ways:
 *
 *  - "Monthly" was 30 days, so a report scheduled on the 31st walked backwards
 *    through the calendar - Jan 31, Mar 2, Apr 1 - and never landed on the same
 *    day of the month twice.
 *  - "Weekly" had no weekday anchor at all. It fired every ~7 days from whenever
 *    it first happened to run, so a Monday report could settle onto a Thursday.
 *  - The interval carried a one-hour tolerance and the checker runs hourly, so
 *    each send could land an hour earlier than the last and the whole schedule
 *    crept backwards through the day.
 *
 * These are now calendar occurrences in the member's own zone. A schedule is
 * due when the most recent occurrence on or before today has not been sent yet,
 * which also means a delivery missed while the server was down goes out on the
 * next check instead of being skipped until the following period.
 */
const FREQUENCY_DAYS = {
  Daily: 1,
  Weekly: 7,
  "Bi-weekly": 14,
};

function dayStringToUtc(day) {
  return new Date(`${day}T00:00:00.000Z`);
}

function daysBetween(fromDay, toDay) {
  return Math.round((dayStringToUtc(toDay).getTime() - dayStringToUtc(fromDay).getTime()) / DAY_MS);
}

/** Same day-of-month as the anchor, clamped into short months: a schedule
 *  anchored on the 31st is due on the 28th/29th in February and on the 31st
 *  again in March, rather than sliding a few days earlier every month. */
function monthlyOccurrenceOnOrBefore(anchorDay, today) {
  const anchorDate = Number(anchorDay.slice(8, 10));
  const t = dayStringToUtc(today);
  for (let back = 0; back <= 1; back++) {
    const year = t.getUTCFullYear();
    const month = t.getUTCMonth() - back;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidate = new Date(Date.UTC(year, month, Math.min(anchorDate, daysInMonth)));
    const candidateDay = toDateParam(candidate);
    if (candidateDay <= today) return candidateDay;
  }
  return anchorDay;
}

/**
 * The latest day on or before `today` that this schedule was meant to fire,
 * or null if it has not reached its first occurrence yet. Exported for tests.
 */
export function lastScheduledOccurrence(frequency, anchorDay, today) {
  if (today < anchorDay) return null;
  if (frequency === "Monthly") {
    const occurrence = monthlyOccurrenceOnOrBefore(anchorDay, today);
    return occurrence < anchorDay ? anchorDay : occurrence;
  }
  const stride = FREQUENCY_DAYS[frequency] ?? FREQUENCY_DAYS.Weekly;
  const elapsed = daysBetween(anchorDay, today);
  return toDateParam(addDays(dayStringToUtc(anchorDay), elapsed - (elapsed % stride)));
}

export function isReportScheduleDue(schedule, timeZone, now = new Date()) {
  const nowHHMM = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const deliveryHHMM = String(schedule.delivery_time ?? "00:00").slice(0, 5);
  if (nowHHMM < deliveryHHMM) return false;

  const today = localDayFor(now, timeZone);
  // The weekday and day-of-month the schedule keeps come from when it was
  // created, which is the only intent the form actually captures today.
  const anchorDay = localDayFor(new Date(schedule.created_at ?? now), timeZone);
  const occurrence = lastScheduledOccurrence(schedule.frequency, anchorDay, today);
  if (!occurrence) return false;

  if (!schedule.last_sent_at) return true;
  return localDayFor(new Date(schedule.last_sent_at), timeZone) < occurrence;
}

export function parseDeliveryTimeLabel(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(label ?? "").trim());
  if (!m) return null;
  let hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  const period = m[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "am") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}
