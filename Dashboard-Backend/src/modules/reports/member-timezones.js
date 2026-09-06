import { query as pgQuery } from "../../lib/postgres/client.js";
import { canonicalizeTimeZone } from "../../lib/time/timezone-utils.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

export async function getMemberTimezones(db, memberIds) {
  const tzByMember = new Map();
  if (!memberIds || memberIds.length === 0) return tzByMember;

  const rows = await pgQuery("SELECT id, timezone FROM members WHERE id = ANY($1)", [memberIds]);
  for (const row of rows) {
    if (row.id) tzByMember.set(row.id, canonicalizeTimeZone(row.timezone));
  }
  return tzByMember;
}

/**
 * A member's timezone changes maybe once a year (and only when they edit it),
 * but it is now read on every allowance check - i.e. every sync, every 20s,
 * for every actively-tracking member. Caching it briefly keeps that from
 * becoming a per-sync round trip, and the TTL is short enough that an edit
 * takes effect within a minute.
 */
const TZ_CACHE_TTL_MS = 60_000;
const tzCache = new Map();

export function __clearMemberTimezoneCache() {
  tzCache.clear();
}

/**
 * One member's IANA zone, defaulting to UTC when unset, unusable, or
 * unreachable.
 *
 * Fails safe on purpose: this decides which calendar day work is booked
 * against, but a failed lookup must never be able to block someone from
 * tracking time. Falling back to UTC reproduces exactly the behaviour that
 * shipped before day boundaries were timezone-aware, which is a known-safe
 * degradation rather than an outage.
 */
export async function getMemberTimezone(memberId) {
  if (!memberId) return "UTC";

  const cached = tzCache.get(memberId);
  if (cached && Date.now() - cached.at < TZ_CACHE_TTL_MS) return cached.tz;

  let tz = "UTC";
  try {
    const rows = await pgQuery("SELECT timezone FROM members WHERE id = $1", [memberId]);
    tz = canonicalizeTimeZone(rows?.[0]?.timezone);
  } catch (err) {
    logSafeWarn("member timezone lookup failed, defaulting to UTC", err);
    return "UTC";
  }

  tzCache.set(memberId, { tz, at: Date.now() });
  return tz;
}
