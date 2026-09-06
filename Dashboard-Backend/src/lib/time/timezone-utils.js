/**
 * Day-boundary math, in a member's own timezone.
 *
 * Every "what day is this" decision in this codebase - daily/weekly limit
 * resets, the working-day gate, report bucketing - has to agree on which
 * calendar it is asking about. Doing that with fixed UTC offsets is wrong for
 * roughly half the year in any zone that observes DST, and governments change
 * those rules on short notice (Egypt restored DST in 2023; Lebanon moved its
 * switch with two days' warning). So every conversion here goes through
 * `Intl.DateTimeFormat`, which resolves against the IANA database rather than
 * arithmetic we would have to maintain ourselves.
 */

const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

/**
 * Resolve a stored zone to one `Intl` will actually accept.
 *
 * `Intl.supportedValuesOf` lists canonical names only, but real clients still
 * emit legacy aliases (`Asia/Calcutta`, `Europe/Kiev`, `America/Buenos_Aires`).
 * Testing set membership alone would silently downgrade those members to UTC -
 * which, now that day boundaries depend on this, would move someone's whole
 * working day by hours. Asking `Intl` to resolve the value instead accepts
 * aliases (it deliberately echoes the requested id back rather than renaming
 * it, and still applies that zone's real rules) and reserves the UTC fallback
 * for genuinely unusable input.
 */
export function canonicalizeTimeZone(value) {
  const tz = typeof value === "string" ? value.trim() : "";
  if (!tz) return "UTC";
  if (VALID_TIME_ZONES.has(tz)) return tz;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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

/** The local calendar day (`YYYY-MM-DD`) that `date` falls on in `timeZone`. */
export function localDayFor(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

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

export function previousLocalDay(localDay) {
  return addLocalDays(localDay, -1);
}

/**
 * Shift a `YYYY-MM-DD` local day string by whole days.
 *
 * Deliberately pure calendar arithmetic on the day string, with no timezone
 * involved: once a caller has resolved which local day it means, "seven days
 * earlier" is a calendar question, not an instant question. Doing it by
 * subtracting 7*86400s from an instant would land on the wrong day whenever a
 * DST transition falls inside the window.
 */
export function addLocalDays(localDay, days) {
  const d = new Date(`${localDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekday index for a local day string, Monday=0 .. Sunday=6.
 *
 * Matches the indexing `time_settings.work_days` / `makeup_days` are stored
 * in. Takes the day string rather than an instant on purpose: callers have
 * already resolved which local day they mean, and re-deriving it from "now"
 * is exactly the bug this module exists to prevent.
 */
export function weekdayIndexForLocalDay(localDay) {
  const [y, m, d] = localDay.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
