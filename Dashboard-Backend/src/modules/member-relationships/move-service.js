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

/** Most members one request may move: a whole team, not the whole organization. */
export const MAX_BULK_MOVE = 200;

/**
 * Moves several members under the same manager (a whole group dragged onto them). Each is checked
 * and moved on its own, so one the rules refuse is skipped with its reason and never blocks the
 * rest. Returns how many moved and who was skipped.
 */
export async function moveMembersToParent(db, { memberIds, newParentId, actorMemberId }) {
  const unique = [...new Set(memberIds)].slice(0, MAX_BULK_MOVE);
  let moved = 0;
  let unchanged = 0;
  const skipped = [];
  for (const memberId of unique) {
    try {
      const outcome = await moveMemberToParent(db, { memberId, newParentId, actorMemberId });
      if (!outcome.ok) skipped.push({ memberId, code: outcome.code, message: outcome.message });
      else if (outcome.moved) moved += 1;
      else unchanged += 1;
    } catch (error) {
      logSafeError("[member-relationships/move] one member of a bulk move failed", error);
      skipped.push({ memberId, code: "failed", message: "Could not move this member." });
    }
  }
  return { moved, unchanged, skipped };
}
