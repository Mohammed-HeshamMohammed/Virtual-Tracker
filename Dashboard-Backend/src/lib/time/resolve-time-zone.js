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
 * Which calendar a project's work is measured in.
 *
 * In order: this member's own override for *this* project (the rare case of
 * one person working different regions on different projects in the same week
 * - see project_members.timezone), then the project's own declared zone, then
 * the member's personal zone. Every level defaults to "not set", so nothing
 * changes for a project/member pair until someone explicitly sets one.
 *
 * That one answer is used for everything measured while working on the
 * project: the member's daily and weekly limits, today's and the week's
 * totals and the activity/idle breakdown beside them, the project's own member
 * limits and the working-day check. Someone in Cairo working a US client's
 * hours sees that project's days line up with the client's calendar.
 *
 * It is applied *when a figure is read*, not when time is recorded: totals are
 * summed from the member's sessions and cut at that calendar's midnights
 * (see sumDailyMemberActiveSeconds). So a person on projects in different
 * zones never has one total made of differently-keyed days, and changing a
 * zone re-cuts history instead of leaving old rows on the old calendar. (The
 * per-day rollup tables are still written, for the reports that read them,
 * but no limit reads them.)
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
