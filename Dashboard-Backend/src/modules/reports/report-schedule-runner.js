import { logSafeWarn } from "../../http/sanitize-error.js";
import { listReportSchedulesPg, markReportScheduleSentPg } from "../../lib/postgres/report-schedules-postgres.service.js";
import { isReportScheduleDue, resolveDateRangeKind } from "./date-range-kind.js";
import { loadTimeAndActivityReportPayloadForMemberIds, buildReportAttachment, rangeLabel } from "./routes.js";
import { getMemberTimezones } from "./member-timezones.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { isEmployeeRole, isViewerRole } from "../../http/role-hierarchy.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let reportScheduleTimer = null;

/**
 * Who the emailed report is *for*, resolved fresh at send time.
 *
 * Two things were wrong before, and both came from the runner never modelling
 * a viewer at all.
 *
 * 1. **Every scheduled report had no money in it.** The payload loader takes a
 *    viewer so it can decide whose pay rates the reader is allowed to see; the
 *    runner omitted it, so the rate map came back empty and every amount in
 *    every emailed PDF was 0.00 - while the same report on screen showed real
 *    figures. Nothing failed; the numbers were just silently absent.
 *
 * 2. **A schedule saved for the whole team emailed one person.** `member_id`
 *    is null when no member filter was chosen, meaning "everyone the creator
 *    can see". `member_id ?? created_by` read that null as "just the creator",
 *    quietly narrowing a team report to a single row.
 *
 * Resolving scope now rather than trusting what was stored also means a
 * schedule stops delivering when its creator's access is narrowed or removed,
 * instead of running on the permissions they had on the day they saved it.
 */
async function resolveScheduleAudience(db, schedule) {
  const creatorId = String(schedule.created_by ?? "");
  if (!creatorId) return null;

  const roleName = await resolveMemberRoleName(db, creatorId);
  // Reports are refused to the Viewer role at the route; a standing schedule
  // must not be a way around that.
  if (isViewerRole(roleName)) return null;

  const viewer = { memberId: creatorId, roleName };
  const visibleIds = isEmployeeRole(roleName)
    ? [creatorId]
    : await getVisibleMemberIds(db, creatorId, roleName);

  const requested = schedule.member_id ? String(schedule.member_id) : null;
  if (!requested) return { viewer, memberIds: visibleIds };

  if (visibleIds !== null && !visibleIds.includes(requested)) return null;
  return { viewer, memberIds: [requested] };
}

async function runReportSchedule(db, schedule, timeZone, audience) {
  const { from, to } = resolveDateRangeKind(schedule.date_range_kind, timeZone);

  const payload = await loadTimeAndActivityReportPayloadForMemberIds(
    db,
    audience.memberIds,
    from,
    to,
    audience.viewer,
  );
  const attachment = await buildReportAttachment(payload, schedule.file_type, rangeLabel(from, to));

  const subject = schedule.subject?.trim() || "Time & Activity Report";
  const message = schedule.message?.trim() || "";

  const results = await Promise.all(
    schedule.emails.map((email) =>
      sendEmailViaNotify("report-delivery", { email, subject, message, reportName: "Time & Activity Report", attachment }),
    ),
  );

  return results.some((r) => r.sent);
}

export async function processDueReportSchedules(db) {
  const schedules = await listReportSchedulesPg("time-and-activity");
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    // The clock the schedule keeps is the reported member's when there is one,
    // and otherwise the creator's - the person who chose the delivery time.
    const clockMemberId = schedule.member_id ?? schedule.created_by;
    try {
      const tzMap = await getMemberTimezones(db, [clockMemberId]);
      const timeZone = tzMap.get(clockMemberId) ?? "UTC";

      if (!isReportScheduleDue(schedule, timeZone, now)) continue;

      const audience = await resolveScheduleAudience(db, schedule);
      if (!audience) {
        skipped += 1;
        logSafeWarn(
          `[report-schedule] schedule ${schedule.id} skipped: its creator can no longer view this report`,
        );
        continue;
      }

      processed += 1;
      const didSend = await runReportSchedule(db, schedule, timeZone, audience);
      if (didSend) {
        sent += 1;
        await markReportScheduleSentPg(schedule.id);
      } else {
        logSafeWarn(`[report-schedule] delivery failed for schedule ${schedule.id}, will retry next check`);
      }
    } catch (err) {
      logSafeWarn(`[report-schedule] failed for schedule ${schedule.id}:`, err);
    }
  }

  return { processed, sent, skipped, checkedAt: now.toISOString() };
}

export function scheduleReportDeliveries(db) {
  if (reportScheduleTimer) return;

  const run = () => {
    processDueReportSchedules(db).catch((err) => {
      logSafeWarn("[report-schedule] scheduler run failed:", err);
    });
  };

  run();
  reportScheduleTimer = setInterval(run, CHECK_INTERVAL_MS);
  if (typeof reportScheduleTimer.unref === "function") reportScheduleTimer.unref();
}
