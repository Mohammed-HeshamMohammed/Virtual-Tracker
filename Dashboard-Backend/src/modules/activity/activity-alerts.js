import crypto from "node:crypto";
import { createNotification } from "../notifications/service.js";
import { getMemberAncestors } from "../member-relationships/service.js";
import { getProjectScopedMemberIds, resolveMemberRoleName } from "./activity-scope.js";

const LEADERSHIP_ROLES = new Set(["owner", "superadmin", "admin"]);
const COOLDOWN_MS = 60 * 60 * 1000;
const NO_SCREENSHOT_MS = 15 * 60 * 1000;
const LOW_ACTIVITY_THRESHOLD = 30;

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function getDirectParentIds(db, memberId) {
  const snap = await db
    .collection("member_relationships")
    .where("child_member_id", "==", memberId)
    .limit(20)
    .get();
  return snap.docs.map((d) => d.data()?.parent_member_id).filter(Boolean);
}

/** Leadership on shared projects only (Owner / Super Admin / Admin org roles). */
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

/**
 * Notify managers + project leadership for activity alerts.
 * @param {"employee"|"manager"} subjectLevel
 */
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

async function wasAlertSentRecently(db, subjectMemberId, alertType) {
  const snap = await db
    .collection("activity_alert_log")
    .where("subject_member_id", "==", subjectMemberId)
    .where("alert_type", "==", alertType)
    .limit(5)
    .get();
  const now = Date.now();
  for (const doc of snap.docs) {
    const sentAt = doc.data()?.sent_at;
    const ms =
      sentAt instanceof Date
        ? sentAt.getTime()
        : typeof sentAt?.toDate === "function"
          ? sentAt.toDate().getTime()
          : 0;
    if (now - ms < COOLDOWN_MS) return true;
  }
  return false;
}

async function recordAlertSent(db, subjectMemberId, alertType, recipientIds) {
  const id = crypto.randomUUID();
  await db.collection("activity_alert_log").doc(id).set({
    id,
    subject_member_id: subjectMemberId,
    alert_type: alertType,
    recipient_ids: recipientIds,
    sent_at: new Date(),
  });
}

export async function dispatchActivityAlert(db, subjectMemberId, alertType, title, message, link = "/") {
  if (await wasAlertSentRecently(db, subjectMemberId, alertType)) return { skipped: "cooldown" };

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

  await recordAlertSent(db, subjectMemberId, alertType, recipients);
  return { sent: recipients.length };
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

/** After app-only ingest while session is active — alert if no recent screenshot. */
export async function maybeAlertMissingScreenshot(db, memberId, sessionId) {
  const sessionSnap = await db.collection("activity_sessions").doc(sessionId).get();
  if (!sessionSnap.exists || sessionSnap.data()?.status !== "active") return;

  const snap = await db
    .collection("activity_screenshots")
    .where("member_id", "==", memberId)
    .where("session_id", "==", sessionId)
    .limit(30)
    .get();
  const latest = [...snap.docs].sort(
    (a, b) => timestampMs(b.data()?.captured_at) - timestampMs(a.data()?.captured_at),
  )[0];
  const lastMs = latest ? timestampMs(latest.data()?.captured_at) : 0;
  if (lastMs && Date.now() - lastMs < NO_SCREENSHOT_MS) return;

  const memberDoc = await db.collection("members").doc(memberId).get();
  const name = memberDoc.exists
    ? `${memberDoc.data()?.first_name || ""} ${memberDoc.data()?.last_name || ""}`.trim() || "Team member"
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
  const memberDoc = await db.collection("members").doc(memberId).get();
  const name = memberDoc.exists
    ? `${memberDoc.data()?.first_name || ""} ${memberDoc.data()?.last_name || ""}`.trim() || "Team member"
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
