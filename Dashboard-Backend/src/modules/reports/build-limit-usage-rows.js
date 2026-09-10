/**
 * Limit usage, bucketed into the period the limit is actually about.
 *
 * The report used to sum tracked seconds across the *whole selected range* and
 * divide by a single period's limit. Selecting a month and comparing 160 hours
 * against a 40-hour weekly limit put every member at "100%" (the percentage was
 * clamped, which hid how nonsensical the comparison was), and selecting three
 * days put everyone comfortably under a daily limit they had blown twice. The
 * number was only ever right when the range happened to be exactly one period
 * long.
 *
 * A weekly limit is a statement about a week, so it is compared against one
 * week at a time; a daily limit against one day. A member appears once per
 * period they tracked anything in, and the caller rolls those up per member.
 *
 * Weeks run Monday-Sunday. A week only partly inside the requested range is
 * flagged `partial`, because a half-week's hours against a full week's limit
 * reads as compliance that has not been earned yet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function dayToUtc(day) {
  return new Date(`${day}T00:00:00.000Z`);
}

function toDay(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day, n) {
  return toDay(new Date(dayToUtc(day).getTime() + n * DAY_MS));
}

/** Monday of the ISO week `day` falls in. */
export function weekStart(day) {
  const d = dayToUtc(day);
  const dow = d.getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param usageRows  { memberId, day, activeSeconds } - `day` is already the
 *                   member's own calendar day (daily_member_active_seconds is
 *                   written that way by the agent ingest).
 * @param limitRows  { memberId, weeklyLimitHours, dailyLimitHours }
 * @param kind       "weekly" | "daily"
 */
export function buildLimitUsageRows({ usageRows, limitRows, kind, fromDay, toDay: rangeEnd }) {
  const limitByMember = new Map(limitRows.map((row) => [String(row.memberId), row]));
  const buckets = new Map();

  for (const row of usageRows ?? []) {
    const memberId = String(row.memberId ?? "");
    const day = String(row.day ?? "").slice(0, 10);
    const seconds = Math.max(0, Number(row.activeSeconds) || 0);
    if (!memberId || !day || seconds === 0) continue;

    const periodStart = kind === "weekly" ? weekStart(day) : day;
    const periodEnd = kind === "weekly" ? addDays(periodStart, 6) : day;
    const key = `${memberId} ${periodStart}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.seconds += seconds;
      continue;
    }
    buckets.set(key, { memberId, periodStart, periodEnd, seconds });
  }

  const rows = [];
  for (const bucket of buckets.values()) {
    const limit = limitByMember.get(bucket.memberId);
    const limitHours = Math.max(
      0,
      Number(kind === "weekly" ? limit?.weeklyLimitHours : limit?.dailyLimitHours) || 0,
    );
    const trackedHours = bucket.seconds / 3600;
    rows.push({
      memberId: bucket.memberId,
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      limitHours,
      trackedHours: round2(trackedHours),
      // Not clamped. A member 30% over their limit is the whole point of the
      // report, and rounding that down to "100%" is what made the old numbers
      // look plausible while being wrong.
      pctUsed: limitHours > 0 ? Math.round((trackedHours / limitHours) * 100) : 0,
      overLimit: limitHours > 0 && trackedHours > limitHours,
      partial: bucket.periodStart < fromDay || bucket.periodEnd > rangeEnd,
    });
  }

  rows.sort((a, b) =>
    a.memberId === b.memberId ? a.periodStart.localeCompare(b.periodStart) : a.memberId.localeCompare(b.memberId),
  );
  return rows;
}

/** Per-member summary across the periods in range, for the collapsed row. */
export function summarizeLimitUsage(periodRows) {
  const byMember = new Map();
  for (const row of periodRows) {
    const entry = byMember.get(row.memberId) ?? {
      memberId: row.memberId,
      limitHours: row.limitHours,
      periods: 0,
      periodsOverLimit: 0,
      totalTrackedHours: 0,
      peakPctUsed: 0,
    };
    entry.periods += 1;
    if (row.overLimit) entry.periodsOverLimit += 1;
    entry.totalTrackedHours = round2(entry.totalTrackedHours + row.trackedHours);
    entry.peakPctUsed = Math.max(entry.peakPctUsed, row.pctUsed);
    byMember.set(row.memberId, entry);
  }
  return [...byMember.values()];
}
