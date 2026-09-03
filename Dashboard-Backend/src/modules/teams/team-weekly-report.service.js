import { logSafeWarn } from "../../http/sanitize-error.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";
import { canBeTeamLead } from "../../http/team-member-assign-policy.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import { query as pgQuery } from "../../lib/postgres/client.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let weeklyReportTimer = null;

export function parseReportTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export function isWeeklyReportDue(lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= WEEK_MS;
}

export function isActiveMemberRecipient(memberData) {
  const status = typeof memberData.status === "string" ? memberData.status.trim().toLowerCase() : "active";
  return status !== "inactive" && status !== "removed" && status !== "deleted";
}

async function resolveMemberEmail(db, memberId) {
  if (!memberId) return "";
  const data = (await getMemberByIdPg(memberId)) || {};
  if (!isActiveMemberRecipient(data)) return "";
  const work = typeof data.work_email === "string" ? data.work_email.trim() : "";
  const personal = typeof data.personal_email === "string" ? data.personal_email.trim() : "";
  return work || personal;
}

export async function collectWeeklyReportRecipientIds(db, teamId, teamData, teamMemberRows) {
  const recipientIds = new Set();
  const createdBy = typeof teamData.created_by === "string" ? teamData.created_by : "";
  if (createdBy) {
    const creator = (await getMemberByIdPg(createdBy)) || {};
    if (isActiveMemberRecipient(creator)) {
      recipientIds.add(createdBy);
    }
  }

  for (const row of teamMemberRows) {
    if (row.is_lead !== true && row.role !== "lead") continue;
    const memberId = typeof row.member_id === "string" ? row.member_id : "";
    if (!memberId || memberId === createdBy) continue;
    const roleName = await resolveMemberRoleName(db, memberId);
    if (!canBeTeamLead(roleName)) continue;
    const member = (await getMemberByIdPg(memberId)) || {};
    if (!isActiveMemberRecipient(member)) continue;
    recipientIds.add(memberId);
  }

  return [...recipientIds];
}

export async function sendTeamWeeklyReport(db, teamId, teamData) {
  if (teamData.schedule_weekly_report !== true) {
    return { sent: 0, skipped: true, reason: "disabled" };
  }

  const teamName = typeof teamData.name === "string" && teamData.name.trim() ? teamData.name.trim() : "Team";
  const teamMemberRows = await pgQuery("SELECT * FROM team_members WHERE team_id = $1", [teamId]);
  const recipientIds = await collectWeeklyReportRecipientIds(db, teamId, teamData, teamMemberRows);

  const emails = new Set();
  for (const memberId of recipientIds) {
    const email = await resolveMemberEmail(db, memberId);
    if (email) emails.add(email.toLowerCase());
  }

  if (!emails.size) {
    return { sent: 0, skipped: true, reason: "no_recipients" };
  }

  const memberCount = teamMemberRows.length;
  const appUrl = resolveAppPublicUrl();

  let sent = 0;
  for (const to of emails) {
    const result = await sendEmailViaNotify("team-weekly-report", {
      email: to,
      teamName,
      memberCount,
      appUrl,
    });
    if (result.sent) sent += 1;
  }

  if (sent > 0) {
    await pgQuery("UPDATE teams SET last_weekly_report_sent_at = NOW(), updated_at = NOW() WHERE id = $1", [teamId]);
  }

  return { sent, recipients: emails.size };
}

export async function processDueTeamWeeklyReports(db) {
  const teams = await pgQuery("SELECT * FROM teams WHERE schedule_weekly_report = true");
  const now = new Date();
  let processed = 0;
  let sentTeams = 0;

  for (const data of teams) {
    if (data.schedule_weekly_report !== true) continue;
    const lastSentAt = parseReportTimestamp(data.last_weekly_report_sent_at);
    if (!isWeeklyReportDue(lastSentAt, now)) continue;

    processed += 1;
    try {
      const result = await sendTeamWeeklyReport(db, data.id, data);
      if (result.sent > 0) sentTeams += 1;
    } catch (err) {
      logSafeWarn(`[team-weekly-report] failed for team ${data.id}:`, err);
    }
  }

  return { processed, sentTeams, checkedAt: now.toISOString() };
}

export function scheduleTeamWeeklyReports(db) {
  if (weeklyReportTimer) return;

  const run = () => {
    processDueTeamWeeklyReports(db).catch((err) => {
      logSafeWarn("[team-weekly-report] scheduler run failed:", err);
    });
  };

  run();
  weeklyReportTimer = setInterval(run, CHECK_INTERVAL_MS);
  if (typeof weeklyReportTimer.unref === "function") weeklyReportTimer.unref();
}
