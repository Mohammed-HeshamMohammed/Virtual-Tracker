import { FieldValue } from "firebase-admin/firestore";
import { getMemberAncestors } from "../member-relationships/service.js";
import { createNotification } from "./service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { resolveMemberDisplayName } from "../members/services/member-display-name.js";

/** Members created via Add members (invites or pre-provisioned accounts). */
const TEAM_ADDED_CREATED_BY = new Set(["invite-preprovision", "self-invite"]);

/**
 * @param {Record<string, unknown>|null|undefined} memberData
 */
export function isTeamAddedMember(memberData) {
  if (!memberData || typeof memberData !== "object") return false;
  const createdBy = typeof memberData.created_by === "string" ? memberData.created_by.trim() : "";
  return TEAM_ADDED_CREATED_BY.has(createdBy);
}

/**
 * @param {Record<string, unknown>|null|undefined} memberData
 * @param {Record<string, unknown>|null|undefined} [profile]
 * @param {{ displayName?: string|null }} [userRecord]
 */
export function formatMemberDisplayName(memberData, profile, userRecord) {
  const dbName = resolveMemberDisplayName(memberData || {});
  if (dbName && dbName !== "Unknown") return dbName;
  const profileName =
    profile && typeof profile === "object"
      ? typeof profile.displayName === "string"
        ? profile.displayName
        : typeof profile.display_name === "string"
          ? profile.display_name
          : ""
      : "";
  if (profileName.trim()) return profileName.trim();
  if (userRecord && typeof userRecord.displayName === "string" && userRecord.displayName.trim()) {
    return userRecord.displayName.trim();
  }
  return "A new member";
}

/**
 * Resolve adder + upline recipients for a newly joined team member.
 * Uses hierarchy ancestors when available; falls back to created_by_uid lookup.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {Record<string, unknown>} memberData
 * @returns {Promise<string[]>}
 */
export async function resolveFirstLoginNotifyRecipients(db, memberId, memberData) {
  const recipientIds = new Set();

  const ancestors = await getMemberAncestors(db, memberId);
  for (const ancestor of ancestors) {
    if (ancestor.member_id && ancestor.member_id !== memberId) {
      recipientIds.add(ancestor.member_id);
    }
  }

  if (recipientIds.size > 0) {
    return [...recipientIds];
  }

  const createdByUid =
    typeof memberData.created_by_uid === "string" ? memberData.created_by_uid.trim() : "";
  if (!createdByUid) return [];

  const creatorQuery = await db
    .collection("members")
    .where("firebase_uid", "==", createdByUid)
    .limit(1)
    .get();
  if (creatorQuery.empty) return [];

  const adderMemberId = creatorQuery.docs[0].id;
  if (adderMemberId !== memberId) {
    recipientIds.add(adderMemberId);
  }

  const adderAncestors = await getMemberAncestors(db, adderMemberId);
  for (const ancestor of adderAncestors) {
    if (ancestor.member_id && ancestor.member_id !== memberId) {
      recipientIds.add(ancestor.member_id);
    }
  }

  return [...recipientIds];
}

/**
 * Notify the adder and upline when a team-added member completes their first sign-in.
 * Idempotent via members.first_login_notified_at.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{
 *   memberId: string
 *   memberData: Record<string, unknown>
 *   profile?: Record<string, unknown>|null
 *   userRecord?: { displayName?: string|null }
 * }} input
 * @returns {Promise<{ notified: boolean; recipientCount: number }>}
 */
export async function maybeNotifyTeamMemberFirstLogin(db, input) {
  const { memberId, memberData, profile, userRecord } = input;

  if (!memberId || !isTeamAddedMember(memberData)) {
    return { notified: false, recipientCount: 0 };
  }

  const memberRef = db.collection("members").doc(memberId);
  const shouldNotify = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) return false;
    const row = snap.data() || {};
    if (row.first_login_notified_at || row.firstLoginNotifiedAt) return false;
    tx.update(memberRef, {
      first_login_notified_at: FieldValue.serverTimestamp(),
      firstLoginNotifiedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!shouldNotify) {
    return { notified: false, recipientCount: 0 };
  }

  const recipientIds = await resolveFirstLoginNotifyRecipients(db, memberId, memberData);
  if (recipientIds.length === 0) {
    return { notified: false, recipientCount: 0 };
  }

  const displayName = formatMemberDisplayName(memberData, profile ?? null, userRecord);
  for (const recipientId of recipientIds) {
    try {
      await createNotification(db, {
        recipient_id: recipientId,
        type: "member_first_login",
        title: "New member joined",
        message: `${displayName} completed their first sign-in and is now active on the team.`,
        link: "/people/members",
      });
    } catch (err) {
      logSafeWarn("[first-login-notify] failed to create notification:", err);
    }
  }

  return { notified: true, recipientCount: recipientIds.length };
}
