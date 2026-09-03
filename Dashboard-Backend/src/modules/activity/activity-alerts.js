import { createNotification } from "../notifications/service.js";
import { getMemberAncestors } from "../member-relationships/service.js";
import { getProjectScopedMemberIds, resolveMemberRoleName } from "./activity-scope.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import { normalizeRoleKey } from "../../http/role-key.js";
import {
  fetchLatestPgScreenshot,
  getPgSessionById,
  recordPgAlertSent,
  wasPgAlertSentRecently,
} from "../../lib/postgres/activity-events-postgres.service.js";

const LEADERSHIP_ROLES = new Set(["owner", "superadmin", "admin"]);
const COOLDOWN_MS = 60 * 60 * 1000;
const NO_SCREENSHOT_MS = 15 * 60 * 1000;
const LOW_ACTIVITY_THRESHOLD = 30;

function normalizeRole(roleName) {
  return normalizeRoleKey(roleName);
}

async function getDirectParentIds(_db, memberId) {
  const rows = await pgQuery(
    "SELECT parent_member_id FROM member_relationships WHERE child_member_id = $1 LIMIT 20",
    [memberId],
  );
  return rows.map((r) => r.parent_member_id).filter(Boolean);
}

async function getProjectLeadershipRecipientIds(db, subjectMemberId) {
  const projectPeers = await getProjectScopedMemberIds(db, subjectMemberId);
  const recipients = new Set();
  for (const memberId of projectPeers) {
    if (memberId === subjectMemberId) continue;
    const role = normalizeRole(await resolveMemberRoleName(db, memberId));
    if (LEADERSHIP_ROLES.has(role)) recipients.add(memberId);
  }
  return recipients;
}

export async function resolveActivityAlertRecipients(db, subjectMemberId, subjectLevel = "employee") {
  const recipients = new Set();

  const parents = await getDirectParentIds(db, subjectMemberId);
  for (const parentId of parents) recipients.add(parentId);

  const ancestors = await getMemberAncestors(db, subjectMemberId);
  for (const row of ancestors) {
    if (row.member_id) recipients.add(row.member_id);
  }

  for (const leaderId of await getProjectLeadershipRecipientIds(db, subjectMemberId)) {
    recipients.add(leaderId);
  }

  if (subjectLevel === "manager") {
    recipients.delete(subjectMemberId);
    for (const parentId of parents) recipients.delete(parentId);
  }

  recipients.delete(subjectMemberId);
  return [...recipients];
}

async function wasAlertSentRecently(subjectMemberId, alertType) {
  return wasPgAlertSentRecently(subjectMemberId, alertType, COOLDOWN_MS);
}

async function recordAlertSent(subjectMemberId, alertType, recipientIds) {
  await recordPgAlertSent(subjectMemberId, alertType, recipientIds);
}

export async function dispatchActivityAlert(db, subjectMemberId, alertType, title, message, link = "/") {
  if (await wasAlertSentRecently(subjectMemberId, alertType)) return { skipped: "cooldown" };

  const roleName = await resolveMemberRoleName(db, subjectMemberId);
  const roleKey = normalizeRole(roleName);
  const subjectLevel = ["manager", "supermanager"].includes(roleKey) ? "manager" : "employee";

  const recipients = await resolveActivityAlertRecipients(db, subjectMemberId, subjectLevel);
  if (recipients.length === 0) return { skipped: "no_recipients" };

  for (const recipientId of recipients) {
    await createNotification(db, {
      recipient_id: recipientId,
      type: alertType,
      title,
      message,
      link,
    });
  }

  await recordAlertSent(subjectMemberId, alertType, recipients);
  return { sent: recipients.length };
}

export async function maybeAlertMissingScreenshot(db, memberId, sessionId) {
  const session = await getPgSessionById(sessionId);
  if (!session || session.status !== "active") return;

  const latest = await fetchLatestPgScreenshot(memberId, sessionId);
  const lastMs = latest?.captured_at ? new Date(latest.captured_at).getTime() : 0;
  if (lastMs && Date.now() - lastMs < NO_SCREENSHOT_MS) return;

  const memberData = await getMemberByIdPg(memberId);
  const name = memberData
    ? `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || "Team member"
    : "Team member";

  await dispatchActivityAlert(
    db,
    memberId,
    "activity_no_screenshot",
    "No recent activity capture",
    `${name} has had no screenshot in the last ${Math.round(NO_SCREENSHOT_MS / 60000)} minutes while the timer is active.`,
    "/?page=activity-screenshots",
  );
}

export async function maybeAlertLowActivity(db, memberId, sessionId, activityLevel) {
  if (activityLevel >= LOW_ACTIVITY_THRESHOLD) return;
  const memberData = await getMemberByIdPg(memberId);
  const name = memberData
    ? `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || "Team member"
    : "Team member";

  await dispatchActivityAlert(
    db,
    memberId,
    "activity_low_level",
    "Low activity detected",
    `${name} reported activity level ${activityLevel}% on the latest capture.`,
    "/?page=activity-screenshots",
  );
}
