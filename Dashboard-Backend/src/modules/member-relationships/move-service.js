import { query } from "../../lib/postgres/client.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { loadMembersWithRoleNames } from "../hierarchy/hierarchy-repair.js";
import { isExcludedFromHierarchy } from "../hierarchy/hierarchy-placement.js";
import { syncMemberHierarchyStatus } from "../hierarchy/hierarchy-sync.js";
import { normalizeRoleKey, rolePrivilegeRank } from "../members/services/relation-sync.js";
import { planMemberMove } from "./move-plan.js";
import { RelationshipIntegrityError } from "./relationship-integrity.js";
import { recordMemberRelationship, removeMemberParentEdge } from "./service.js";

/**
 * Puts `memberId` under `newParentId`. Everything that can be refused is refused before anything
 * is written; the two writes (drop the old edge, add the new one) are not one transaction, so a
 * failure on the second puts the old edge back rather than leaving the member without a manager.
 */
export async function moveMemberToParent(db, { memberId, newParentId, actorMemberId }) {
  const [{ roleNameByMemberId }, edges] = await Promise.all([
    loadMembersWithRoleNames(db),
    query("SELECT id, parent_member_id, child_member_id FROM member_relationships"),
  ]);

  const plan = planMemberMove({
    memberId,
    newParentId,
    edges,
    roleOf: (id) => roleNameByMemberId.get(String(id)),
    roleKey: normalizeRoleKey,
    rankOf: rolePrivilegeRank,
    isExternal: isExcludedFromHierarchy,
  });
  if (!plan.ok) return plan;
  if (plan.noop) return { ok: true, moved: false, previousParentId: plan.previousParentId, parentId: newParentId };

  const previousParentId = plan.previousParentId;
  await removeMemberParentEdge(db, memberId);
  try {
    await recordMemberRelationship(db, {
      parentMemberId: newParentId,
      childMemberId: memberId,
      relationshipType: "admin_create",
      createdBy: actorMemberId || newParentId,
    });
  } catch (error) {
    if (previousParentId) {
      try {
        await recordMemberRelationship(db, {
          parentMemberId: previousParentId,
          childMemberId: memberId,
          relationshipType: "admin_create",
          createdBy: actorMemberId || previousParentId,
        });
      } catch (restoreError) {
        logSafeError("[member-relationships/move] could not restore the previous manager", restoreError);
      }
    }
    if (error instanceof RelationshipIntegrityError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }

  try {
    await syncMemberHierarchyStatus(db, memberId, roleNameByMemberId.get(String(memberId)) ?? "Viewer");
  } catch (statusError) {
    // The move itself has happened; a stale status label is repaired on the next tree load.
    logSafeError("[member-relationships/move] hierarchy status sync failed", statusError);
  }
  return { ok: true, moved: true, previousParentId, parentId: newParentId };
}
