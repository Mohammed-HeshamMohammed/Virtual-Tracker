import { getVisibleMemberIds } from "../modules/member-relationships/service.js";

/**
 * Scoped viewers (Manager+) may only mutate invites they created.
 * Admin / Owner / Super Admin (sees_all) may manage any invite.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string, uid?: string } | null | undefined} viewer
 * @param {{ created_by_uid?: string }} inviteRow
 * @returns {Promise<boolean>}
 */
export async function canViewerManageInvite(db, viewer, inviteRow) {
  if (!viewer?.memberId) return false;
  const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
  if (visibleIds === null) return true;
  const viewerUid = typeof viewer.uid === "string" ? viewer.uid : "";
  const createdByUid = typeof inviteRow?.created_by_uid === "string" ? inviteRow.created_by_uid : "";
  return Boolean(viewerUid && createdByUid && createdByUid === viewerUid);
}
