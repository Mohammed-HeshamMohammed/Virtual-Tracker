import { query as pgQuery } from "../postgres/client.js";
import { canonicalizeTimeZone } from "./timezone-utils.js";
import { getMemberTimezone } from "../../modules/reports/member-timezones.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

/**
 * Which calendar governs which decision.
 *
 * There are two legitimately different answers, and using one for both would
 * be wrong in opposite directions:
 *
 * - **A member's personal daily/weekly limit** is a fact about that person -
 *   they cannot work two different "todays" at once. It is always measured in
 *   the member's own zone, even when their work spans projects in several
 *   regions. Bucketing personal totals per project would make a personal cap
 *   incoherent (two projects could each grant a fresh day).
 *
 * - **A project's own caps, schedule and reporting** belong to that project's
 *   timeline. Someone in Cairo working a US client's hours should see that
 *   project's days line up with the client's calendar, not their own.
 *
 * Hence: personal totals use the member's zone; project/task-scoped totals use
 * the project's zone when it declares one, and fall back to the member's when
 * it does not (which is every project today, so nothing changes until someone
 * sets one).
 */
export async function resolveProjectTimeZone(projectId, memberId) {
  const memberZone = await getMemberTimezone(memberId);
  if (!projectId) return memberZone;

  try {
    const rows = await pgQuery("SELECT timezone FROM projects WHERE id = $1", [projectId]);
    const declared = typeof rows?.[0]?.timezone === "string" ? rows[0].timezone.trim() : "";
    if (!declared) return memberZone;
    const canonical = canonicalizeTimeZone(declared);
    // canonicalizeTimeZone falls back to UTC for anything unusable; treat that
    // as "not declared" rather than silently moving the project to UTC.
    return canonical === "UTC" && declared !== "UTC" ? memberZone : canonical;
  } catch (err) {
    logSafeWarn("project timezone lookup failed, using the member's zone", err);
    return memberZone;
  }
}
