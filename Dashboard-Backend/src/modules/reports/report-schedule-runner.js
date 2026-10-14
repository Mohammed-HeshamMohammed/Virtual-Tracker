import { logSafeWarn } from "../../http/sanitize-error.js";
import { listReportSchedulesPg, markReportScheduleSentPg } from "../../lib/postgres/report-schedules-postgres.service.js";
import { isReportScheduleDue, resolveDateRangeKind } from "./date-range-kind.js";
import { loadTimeAndActivityReportPayloadForMemberIds } from "./routes.js";
import { buildReportAttachment, rangeLabel, resolvePdfRequest } from "./report-pdf-service.js";
import { documentName, ReportDocumentError } from "./report-documents.js";
import { getMemberTimezones } from "./member-timezones.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { isEmployeeRole, isViewerRole } from "../../http/role-hierarchy.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { withTenant } from "../../lib/postgres/client.js";
import { forEachActiveTenant } from "../../lib/postgres/active-tenants.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** What runReportSchedule answers when the schedule may no longer be delivered: neither sent nor failed. */
const SKIPPED = "skipped";

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

  // The PDF's design and which document it is were saved with the schedule.
  // Re-checked on every run: a creator who has lost the right to see pay or
  // what clients are charged stops getting that document, instead of it
  // carrying on with the access they had the day they saved it.
  const wantsPdf = String(schedule.file_type).toLowerCase() === "pdf";
  let options = null;
  let currency = null;
  if (wantsPdf) {
    try {
      ({ options, currency } = await resolvePdfRequest(audience.viewer, schedule.pdf_options, { from, to }));
    } catch (err) {
      if (err instanceof ReportDocumentError) {
        logSafeWarn(`[report-schedule] schedule ${schedule.id} skipped: ${err.message}`);
        return SKIPPED;
      }
      throw err;
    }
  }
  // A pay slip is for one member; everything else reports on the audience.
  const memberIds = options?.document === "payslip" ? [options.memberId] : audience.memberIds;
  if (options?.document === "payslip" && audience.memberIds !== null && !audience.memberIds.includes(options.memberId)) {
    logSafeWarn(`[report-schedule] schedule ${schedule.id} skipped: its creator can no longer see that member`);
    return SKIPPED;
  }

  const payload = await loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to, audience.viewer, null, currency);
  const attachment = await buildReportAttachment(payload, schedule.file_type, rangeLabel(from, to), options);

  const subject = schedule.subject?.trim() || "Time & Activity Report";
  const message = schedule.message?.trim() || "";
  const reportName = options ? documentName(options) : "Time & Activity Report";

  const results = await Promise.all(
    schedule.emails.map((email) =>
      sendEmailViaNotify("report-delivery", { email, subject, message, reportName, attachment }),
    ),
  );

  return results.some((r) => r.sent);
}

export async function processDueReportSchedules(db) {
  // Listed per tenant, not in one unscoped query: under RLS an unscoped list
  // sees nothing, and an expired or removed tenant gets no report emails.
  const perTenant = await forEachActiveTenant(
    async (tenantId) =>
      (await listReportSchedulesPg("time-and-activity")).map((s) => ({ ...s, tenant_id: s.tenant_id ?? tenantId })),
    { includeInactive: false, label: "report-schedules" },
  );
  const schedules = perTenant.flat();
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    // The clock the schedule keeps is the reported member's when there is one,
    // and otherwise the creator's - the person who chose the delivery time.
    const clockMemberId = schedule.member_id ?? schedule.created_by;
    try {
      // §15.2: this loop has no HTTP request to carry a tenant through
      // auth-context.js, so it opens its own scope per schedule instead -
      // every query below (timezone lookup, audience resolution, the report
      // itself) runs against exactly the one tenant this schedule belongs
      // to, never mixing rows across tenants the way one unscoped query
      // over every schedule at once would risk.
      const { processedHere, sentHere, skippedHere } = await withTenant(schedule.tenant_id ?? MAIN_TENANT_ID, async () => {
        const tzMap = await getMemberTimezones(db, [clockMemberId]);
        const timeZone = tzMap.get(clockMemberId) ?? "UTC";

        if (!isReportScheduleDue(schedule, timeZone, now)) {
          return { processedHere: 0, sentHere: 0, skippedHere: 0 };
        }

        const audience = await resolveScheduleAudience(db, schedule);
        if (!audience) {
          logSafeWarn(
            `[report-schedule] schedule ${schedule.id} skipped: its creator can no longer view this report`,
          );
          return { processedHere: 0, sentHere: 0, skippedHere: 1 };
        }

        const didSend = await runReportSchedule(db, schedule, timeZone, audience);
        if (didSend === SKIPPED) return { processedHere: 0, sentHere: 0, skippedHere: 1 };
        if (didSend) {
          await markReportScheduleSentPg(schedule.id);
          return { processedHere: 1, sentHere: 1, skippedHere: 0 };
        }
        logSafeWarn(`[report-schedule] delivery failed for schedule ${schedule.id}, will retry next check`);
        return { processedHere: 1, sentHere: 0, skippedHere: 0 };
      });
      processed += processedHere;
      sent += sentHere;
      skipped += skippedHere;
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
