// Recurring "Schedule" delivery for reports - same interval-timer pattern as
// team-weekly-report.service.js (setInterval + CHECK_INTERVAL_MS), reused here
// instead of adding a job-queue dependency for one feature.
import { logSafeWarn } from "../../http/sanitize-error.js";
import { listReportSchedulesPg, markReportScheduleSentPg } from "../../lib/postgres/report-schedules-postgres.service.js";
import { isReportScheduleDue, resolveDateRangeKind } from "./date-range-kind.js";
import { loadTimeAndActivityReportPayloadForMemberIds, buildReportAttachment, rangeLabel } from "./routes.js";
import { getMemberTimezones } from "./member-timezones.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly, same cadence as team-weekly-report

/** @type {ReturnType<typeof setInterval> | null} */
let reportScheduleTimer = null;

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ id: string, member_id: string | null, created_by: string, emails: string[],
 *   subject: string | null, message: string | null, file_type: string, date_range_kind: string }} schedule
 * @param {string} timeZone the target member's timezone - "today"/"last 7 days" etc. resolve against it
 */
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

/** @param {import("firebase-admin/firestore").Firestore} db */
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
      if (didSend) sent += 1;
      await markReportScheduleSentPg(schedule.id);
    } catch (err) {
      logSafeWarn(`[report-schedule] failed for schedule ${schedule.id}:`, err);
    }
  }

  return { processed, sent, checkedAt: now.toISOString() };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
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
