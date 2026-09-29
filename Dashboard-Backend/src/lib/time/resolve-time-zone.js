import { query as pgQuery } from "../postgres/client.js";
import { canonicalizeTimeZone } from "./timezone-utils.js";
import { getMemberTimezone } from "../../modules/reports/member-timezones.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

/**
 * A declared zone, canonicalized - or null if it wasn't really declared.
 *
 * canonicalizeTimeZone falls back to "UTC" for anything unusable, which would
 * otherwise be indistinguishable from a project/membership that genuinely
 * chose UTC. Treating an unusable value as "not declared" (fall through to
 * the next level) rather than silently moving someone to UTC is the same
 * judgment call already made for the project-level lookup below.
 */
function declaredZoneOrNull(raw) {
  const declared = typeof raw === "string" ? raw.trim() : "";
  if (!declared) return null;
  const canonical = canonicalizeTimeZone(declared);
  return canonical === "UTC" && declared !== "UTC" ? null : canonical;
}

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
 * Hence: personal totals use the member's zone; project/task-scoped totals
 * use, in order: this member's own override for *this* project (the rare
 * case of one person working different regions on different projects in the
 * same week - see project_members.timezone), then the project's own
 * declared zone, then the member's personal zone. Every level defaults to
 * "not set", so nothing changes for the project/member pair until someone
 * explicitly sets an override at that specific level.
 */
export async function resolveProjectTimeZone(projectId, memberId) {
  const memberZone = await getMemberTimezone(memberId);
  if (!projectId) return memberZone;

  try {
    if (memberId) {
      const membershipRows = await pgQuery(
        "SELECT timezone FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 1",
        [projectId, memberId],
      );
      const membershipZone = declaredZoneOrNull(membershipRows?.[0]?.timezone);
      if (membershipZone) return membershipZone;
    }

    const projectRows = await pgQuery("SELECT timezone FROM projects WHERE id = $1", [projectId]);
    return declaredZoneOrNull(projectRows?.[0]?.timezone) ?? memberZone;
  } catch (err) {
    logSafeWarn("project timezone lookup failed, using the member's zone", err);
    return memberZone;
  }
}
