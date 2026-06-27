import { logSafeWarn } from "../../http/sanitize-error.js";
import { sendTransactionalEmail, escapeHtml } from "../auth/transactional-email.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";
import { canBeTeamLead } from "../../http/team-member-assign-policy.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** @type {ReturnType<typeof setInterval> | null} */
let weeklyReportTimer = null;

/**
 * @param {Date | import("firebase-admin/firestore").Timestamp | string | null | undefined} value
 */
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

/**
 * @param {Date | null} lastSentAt
 * @param {Date} [now]
 */
export function isWeeklyReportDue(lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= WEEK_MS;
}

/**
 * @param {Record<string, unknown>} memberData
 */
export function isActiveMemberRecipient(memberData) {
  const status = typeof memberData.status === "string" ? memberData.status.trim().toLowerCase() : "active";
  return status !== "inactive" && status !== "removed" && status !== "deleted";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function resolveMemberEmail(db, memberId) {
  if (!memberId) return "";
  const snap = await db.collection("members").doc(memberId).get();
  if (!snap.exists) return "";
  const data = snap.data() || {};
  if (!isActiveMemberRecipient(data)) return "";
  const work = typeof data.work_email === "string" ? data.work_email.trim() : "";
  const personal = typeof data.personal_email === "string" ? data.personal_email.trim() : "";
  return work || personal;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} teamId
 * @param {Record<string, unknown>} teamData
 * @param {import("firebase-admin/firestore").QueryDocumentSnapshot[]} teamMemberDocs
 */
export async function collectWeeklyReportRecipientIds(db, teamId, teamData, teamMemberDocs) {
  const recipientIds = new Set();
  const createdBy = typeof teamData.created_by === "string" ? teamData.created_by : "";
  if (createdBy) {
    const creatorSnap = await db.collection("members").doc(createdBy).get();
    if (creatorSnap.exists && isActiveMemberRecipient(creatorSnap.data() || {})) {
      recipientIds.add(createdBy);
    }
  }

  for (const doc of teamMemberDocs) {
    const row = doc.data() || {};
    if (row.is_lead !== true) continue;
    const memberId = typeof row.member_id === "string" ? row.member_id : "";
    if (!memberId || memberId === createdBy) continue;
    const roleName = await resolveMemberRoleName(db, memberId);
    if (!canBeTeamLead(roleName)) continue;
    const memberSnap = await db.collection("members").doc(memberId).get();
    if (!memberSnap.exists || !isActiveMemberRecipient(memberSnap.data() || {})) continue;
    recipientIds.add(memberId);
  }

  return [...recipientIds];
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} teamId
 * @param {Record<string, unknown>} teamData
 */
export async function sendTeamWeeklyReport(db, teamId, teamData) {
  if (teamData.schedule_weekly_report !== true) {
    return { sent: 0, skipped: true, reason: "disabled" };
  }

  const teamName = typeof teamData.name === "string" && teamData.name.trim() ? teamData.name.trim() : "Team";
  const teamMembersSnap = await db.collection("team_members").where("team_id", "==", teamId).get();
  const recipientIds = await collectWeeklyReportRecipientIds(db, teamId, teamData, teamMembersSnap.docs);

  const emails = new Set();
  for (const memberId of recipientIds) {
    const email = await resolveMemberEmail(db, memberId);
    if (email) emails.add(email.toLowerCase());
  }

  if (!emails.size) {
    return { sent: 0, skipped: true, reason: "no_recipients" };
  }

  const memberCount = teamMembersSnap.size;
  const appUrl = resolveAppPublicUrl();
  const subject = `Weekly team report — ${teamName}`;
  const text =
    `Weekly report for ${teamName}\n\n` +
    `Members on team: ${memberCount}\n\n` +
    `Open your dashboard: ${appUrl}\n`;
  const html =
    `<p>Weekly report for <strong>${escapeHtml(teamName)}</strong></p>` +
    `<p>Members on team: <strong>${memberCount}</strong></p>` +
    `<p><a href="${escapeHtml(appUrl)}">Open your dashboard</a></p>`;

  let sent = 0;
  for (const to of emails) {
    const result = await sendTransactionalEmail({
      to,
      subject,
      text,
      html,
      logPrefix: `[team-weekly-report:${teamId}]`,
    });
    if (result.sent) sent += 1;
  }

  if (sent > 0) {
    await db.collection("teams").doc(teamId).set(
      {
        last_weekly_report_sent_at: new Date(),
        updated_at: new Date(),
      },
      { merge: true },
    );
  }

  return { sent, recipients: emails.size };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function processDueTeamWeeklyReports(db) {
  const teamsSnap = await db.collection("teams").where("schedule_weekly_report", "==", true).get();
  const now = new Date();
  let processed = 0;
  let sentTeams = 0;

  for (const doc of teamsSnap.docs) {
    const data = doc.data() || {};
    if (data.schedule_weekly_report !== true) continue;
    const lastSentAt = parseReportTimestamp(data.last_weekly_report_sent_at);
    if (!isWeeklyReportDue(lastSentAt, now)) continue;

    processed += 1;
    try {
      const result = await sendTeamWeeklyReport(db, doc.id, data);
      if (result.sent > 0) sentTeams += 1;
    } catch (err) {
      logSafeWarn(`[team-weekly-report] failed for team ${doc.id}:`, err);
    }
  }

  return { processed, sentTeams, checkedAt: now.toISOString() };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
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
