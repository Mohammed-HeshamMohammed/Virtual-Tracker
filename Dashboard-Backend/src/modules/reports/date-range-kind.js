// Named date-range presets for scheduled reports. Kept as the exact labels the
// frontend's schedule dialog already offers (SCHEDULE_REPORT_DATE_RANGE_OPTIONS)
// so no separate label->slug mapping layer is needed on either side.
//
// All of this resolves against the target member's own local calendar day, not
// server UTC - same reasoning as build-time-and-activity-rows.js. "Today" for a
// schedule targeting someone in Tokyo should be their Tokyo today.
import { localDayFor } from "./timezone-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateParam(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

/**
 * @param {string} label one of SCHEDULE_REPORT_DATE_RANGE_OPTIONS
 * @param {string} timeZone IANA zone id
 * @param {Date} [now]
 * @returns {{ from: string, to: string }}
 */
export function resolveDateRangeKind(label, timeZone, now = new Date()) {
  // Anchor "today" on the member's local calendar date. This Date is then used
  // purely as a calendar-math scratchpad (add/subtract days, find month/quarter
  // starts) - it's never converted back into a real instant, so treating it as
  // UTC midnight of that calendar date is safe.
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

const FREQUENCY_MS = {
  Daily: DAY_MS,
  Weekly: 7 * DAY_MS,
  "Bi-weekly": 14 * DAY_MS,
  Monthly: 30 * DAY_MS,
};

/**
 * Due when today's delivery time has passed in the member's own timezone AND
 * enough time has elapsed since the last send for this schedule's frequency
 * (1 hour of slack for check-interval granularity).
 * @param {{ delivery_time: string, last_sent_at: string | Date | null, frequency: string }} schedule
 * @param {string} timeZone IANA zone id
 * @param {Date} [now]
 */
export function isReportScheduleDue(schedule, timeZone, now = new Date()) {
  const nowHHMM = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const deliveryHHMM = String(schedule.delivery_time ?? "00:00").slice(0, 5);
  if (nowHHMM < deliveryHHMM) return false;

  if (!schedule.last_sent_at) return true;

  const intervalMs = FREQUENCY_MS[schedule.frequency] ?? FREQUENCY_MS.Weekly;
  const lastSent = new Date(schedule.last_sent_at);
  return now.getTime() - lastSent.getTime() >= intervalMs - 60 * 60 * 1000;
}

/** Parses a "8:30 am" / "12:00 pm" label into a Postgres TIME literal "08:30:00". */
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
