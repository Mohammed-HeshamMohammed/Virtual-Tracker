import { logSafeWarn } from "../../http/sanitize-error.js";
import { listReportSchedulesPg, markReportScheduleSentPg } from "../../lib/postgres/report-schedules-postgres.service.js";
import { isReportScheduleDue, resolveDateRangeKind } from "./date-range-kind.js";
import { loadTimeAndActivityReportPayloadForMemberIds, buildReportAttachment, rangeLabel } from "./routes.js";
import { getMemberTimezones } from "./member-timezones.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let reportScheduleTimer = null;

async function runReportSchedule(db, schedule, timeZone) {
  const { from, to } = resolveDateRangeKind(schedule.date_range_kind, timeZone);
  const memberIds = [schedule.member_id ?? schedule.created_by];

  const payload = await loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to);
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

  for (const schedule of schedules) {
    const targetMemberId = schedule.member_id ?? schedule.created_by;
    try {
      const tzMap = await getMemberTimezones(db, [targetMemberId]);
      const timeZone = tzMap.get(targetMemberId) ?? "UTC";

      if (!isReportScheduleDue(schedule, timeZone, now)) continue;
      processed += 1;

      const didSend = await runReportSchedule(db, schedule, timeZone);
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

  return { processed, sent, checkedAt: now.toISOString() };
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
