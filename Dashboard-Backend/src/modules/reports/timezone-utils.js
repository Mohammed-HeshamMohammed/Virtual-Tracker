// Shared timezone conversion helpers for reports - used by both the day-splitting
// aggregation (build-time-and-activity-rows.js) and the schedule date-range
// resolver (date-range-kind.js). Only ever converts UTC -> local (the easy,
// unambiguous direction); nothing here does local -> UTC except localMidnightUtc,
// which is an approximation used solely to find a session-splitting boundary, not
// to reconstruct exact instants.

/** UTC offset (minutes) for `timeZone` at `date` - handles DST since it's evaluated at that instant. */
export function offsetMinutesAt(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** Local calendar day ('YYYY-MM-DD') for a UTC instant in `timeZone`. */
export function localDayFor(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Approx UTC instant of local midnight starting `localDay` in `timeZone`. */
export function localMidnightUtc(localDay, timeZone) {
  const [y, m, d] = localDay.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = offsetMinutesAt(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

export function nextLocalDay(localDay) {
  const d = new Date(`${localDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
