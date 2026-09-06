/**
 * Moved to `src/lib/time/timezone-utils.js` - day-boundary math is no longer
 * a reporting concern only. Limit enforcement and the working-day gate now
 * resolve days through the same helpers, so they have to agree by
 * construction rather than by two implementations happening to match.
 */
export {
  canonicalizeTimeZone,
  localDayFor,
  localMidnightUtc,
  nextLocalDay,
  offsetMinutesAt,
  previousLocalDay,
  weekdayIndexForLocalDay,
} from "../../lib/time/timezone-utils.js";
