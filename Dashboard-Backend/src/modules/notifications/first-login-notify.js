import { FieldValue } from "firebase-admin/firestore";
import { getMemberAncestors } from "../member-relationships/service.js";
import { createNotification } from "./service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { resolveMemberDisplayName } from "../members/services/member-display-name.js";

const TEAM_ADDED_CREATED_BY = new Set(["invite-preprovision", "self-invite"]);

export function isTeamAddedMember(memberData) {
  if (!memberData || typeof memberData !== "object") return false;
  const createdBy = typeof memberData.created_by === "string" ? memberData.created_by.trim() : "";
  return TEAM_ADDED_CREATED_BY.has(createdBy);
}

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

import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg, updateMemberPg } from "../../lib/postgres/members-postgres.service.js";

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

  const creatorRows = await pgQuery(
    "SELECT id FROM members WHERE firebase_uid = $1 LIMIT 1",
    [createdByUid],
  );
  if (!creatorRows.length) return [];

  const adderMemberId = creatorRows[0].id;
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

export async function maybeNotifyTeamMemberFirstLogin(db, input) {
  const { memberId, memberData, profile, userRecord } = input;

  if (!memberId || !isTeamAddedMember(memberData)) {
    return { notified: false, recipientCount: 0 };
  }

  const fresh = await getMemberByIdPg(memberId);
  if (!fresh) return { notified: false, recipientCount: 0 };
  if (fresh.first_login_notified_at || fresh.firstLoginNotifiedAt) {
    return { notified: false, recipientCount: 0 };
  }

  await updateMemberPg(memberId, {
    first_login_notified_at: new Date().toISOString(),
  });

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
