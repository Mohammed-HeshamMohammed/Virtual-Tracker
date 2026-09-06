import { query as pgQuery } from "../../lib/postgres/client.js";
import { canonicalizeTimeZone } from "../../lib/time/timezone-utils.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { __clearMemberTimezoneCache } from "../reports/member-timezones.js";

function isExplicitUtc(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "UTC" || v === "Etc/UTC" || v === "Etc/GMT" || v === "GMT";
}

/**
 * Decide what to do with the timezone the agent reported.
 *
 * Pure so the policy itself is testable without a database. The policy:
 * **adopt it only when the member has none stored.**
 *
 * That is the narrow thing this needs to fix. `members.timezone` is only ever
 * written when someone opens the web profile and saves it - the browser
 * auto-detect merely pre-fills the field - so anyone who lives in the desktop
 * agent had no timezone at all and silently fell back to UTC, which is the
 * wrong calendar to book their hours against.
 *
 * It deliberately does *not* keep overwriting a zone the member already has.
 * Which day a session's hours land on decides whether a daily cap has been
 * reached, so a client that could redefine its own day boundary at will could
 * roll over to a "new day" on demand and collect a fresh allowance. Filling a
 * blank is safe; continuously trusting the tracked machine is not. Changing an
 * existing zone stays a deliberate act in the profile UI, where it is visible
 * and attributable.
 */
export function decideTimezoneAdoption(storedTimeZone, reportedTimeZone) {
  if (!reportedTimeZone) return { action: "none" };

  const canonical = canonicalizeTimeZone(reportedTimeZone);
  // canonicalizeTimeZone falls back to UTC for anything it cannot resolve, so
  // an unusable value would otherwise look like a confident "UTC" and get
  // written into an empty field. Only treat UTC as a real answer when the
  // agent actually said UTC.
  if (canonical === "UTC" && !isExplicitUtc(reportedTimeZone)) return { action: "none" };

  const stored = typeof storedTimeZone === "string" ? storedTimeZone.trim() : "";
  if (!stored) return { action: "adopt", timeZone: canonical };

  const storedCanonical = canonicalizeTimeZone(stored);
  if (storedCanonical !== canonical) {
    return { action: "diverged", stored: storedCanonical, reported: canonical };
  }
  return { action: "none" };
}

/**
 * Fill in a member's timezone from what their agent reported, if they have
 * none. Best-effort: this runs on the session hot path, and failing to record
 * a timezone must never be able to stop someone tracking time.
 */
export async function adoptReportedTimezone(memberId, reportedTimeZone) {
  if (!memberId || !reportedTimeZone) return;
  try {
    const rows = await pgQuery("SELECT timezone FROM members WHERE id = $1", [memberId]);
    if (rows.length === 0) return;

    const decision = decideTimezoneAdoption(rows[0]?.timezone, reportedTimeZone);
    if (decision.action === "adopt") {
      await pgQuery("UPDATE members SET timezone = $2 WHERE id = $1", [memberId, decision.timeZone]);
      __clearMemberTimezoneCache();
    } else if (decision.action === "diverged") {
      // Not adopted on purpose (see the policy above), but worth surfacing:
      // it is either travel or a machine whose settings disagree with the
      // member's profile, and both are things someone may want to know.
      logSafeWarn(
        `agent reported timezone ${decision.reported} but member profile says ${decision.stored}; keeping the profile value`,
      );
    }
  } catch (err) {
    logSafeWarn("could not record agent-reported timezone", err);
  }
}
