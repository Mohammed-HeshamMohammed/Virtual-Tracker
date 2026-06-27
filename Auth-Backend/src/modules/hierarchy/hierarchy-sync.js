import { normalizeRoleKey } from "../members/services/relation-sync.js";
import { getMemberParentId } from "../member-relationships/service.js";
import { resolveHierarchyStatus } from "./hierarchy-placement.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

/**
 * Recompute and persist hierarchy_status for a member.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @returns {Promise<string>}
 */
export async function syncMemberHierarchyStatus(db, memberId, roleName) {
  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  const memberData = memberSnap.exists ? memberSnap.data() : {};
  const parentId = await getMemberParentId(db, memberId);
  const status = resolveHierarchyStatus(roleName, parentId, memberData);

  await memberRef.set(
    {
      hierarchy_status: status,
      hierarchy_status_updated_at: new Date(),
    },
    { merge: true },
  );

  return status;
}

/**
 * After a role change, establish hierarchy parent if required.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Object} params
 * @param {string} params.memberId
 * @param {string} params.nextRoleName
 * @param {string} params.actorMemberId
 * @param {string} params.actorRoleName
 * @param {string} actorRoleName
 * @param {{ deferBackground?: boolean; memberData?: Record<string, unknown> | null }} [options]
 * @returns {Promise<{ parentAssigned: boolean; hierarchyStatus: string; error?: string }>}
 */
export async function applyRoleChangeHierarchyEffects(db, {
  memberId,
  nextRoleName,
  actorMemberId,
  actorRoleName,
  deferBackground = false,
  memberData: memberDataInput = null,
}) {
  const { recordMemberRelationship, removeMemberHierarchyRelationships } = await import("../member-relationships/service.js");
  const {
    classifyHierarchyPlacement,
    roleChangeRequiresParentAssignment,
    isExcludedFromHierarchy,
    isOrganizationRootRole,
  } = await import("./hierarchy-placement.js");
  const { hasIndependentHierarchyEntitlement } = await import("./membership-entitlements.js");

  if (isExcludedFromHierarchy(nextRoleName)) {
    await removeMemberHierarchyRelationships(db, memberId);
    const hierarchyStatus = await syncMemberHierarchyStatus(db, memberId, nextRoleName);
    return { parentAssigned: false, hierarchyStatus };
  }

  if (isOrganizationRootRole(nextRoleName)) {
    const { removeMemberParentEdge } = await import("../member-relationships/service.js");
    await removeMemberParentEdge(db, memberId);
    const hierarchyStatus = await syncMemberHierarchyStatus(db, memberId, nextRoleName);
    return { parentAssigned: false, hierarchyStatus };
  }

  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = memberDataInput ? null : await memberRef.get();
  const memberData = memberDataInput ?? (memberSnap?.exists ? memberSnap.data() : {});
  const existingParentId = await getMemberParentId(db, memberId);

  let parentAssigned = false;

  if (
    roleChangeRequiresParentAssignment(nextRoleName, existingParentId, memberData) &&
  !hasIndependentHierarchyEntitlement(memberData)
  ) {
    const actorKey = normalizeRoleKey(actorRoleName);
    const isAdminActor =
      actorKey === "owner" || actorKey === "superadmin" || actorKey === "admin";

    if (isAdminActor || actorMemberId) {
      const parentId = existingParentId || actorMemberId;
      if (parentId && parentId !== memberId) {
        try {
          if (!existingParentId) {
            await recordMemberRelationship(db, {
              parentMemberId: parentId,
              childMemberId: memberId,
              relationshipType: "admin_create",
              createdBy: actorMemberId,
              deferTreeCache: deferBackground,
            });
            parentAssigned = true;
          }
        } catch {
          // Relationship may already exist; continue to status sync
        }
      }
    }
  }

  const parentId = await getMemberParentId(db, memberId);
  const placement = classifyHierarchyPlacement(nextRoleName, parentId, memberData);
  const hierarchyStatus = await syncMemberHierarchyStatus(db, memberId, nextRoleName);

  if (placement === "invalid" || hierarchyStatus === "hierarchy_assignment_required") {
    const notify = async () => {
      try {
        const memberSnap2 = await db.collection("members").doc(memberId).get();
        const email = memberSnap2.data()?.work_email || memberId;
        const { notifyAdminRoles } = await import("./transfer-request.service.js");
        await notifyAdminRoles(
          db,
          "Hierarchy assignment required",
          `Member ${email} requires hierarchy assignment after role change to ${nextRoleName}.`,
          "/people/members-tree",
        );
      } catch (err) {
        logSafeWarn("[hierarchy-sync] admin notify failed:", err);
      }
    };
    if (deferBackground) {
      void notify();
    } else {
      await notify();
    }
  }

  if (placement === "invalid") {
    return {
      parentAssigned,
      hierarchyStatus,
      error: "Hierarchy assignment required for this role.",
    };
  }

  return { parentAssigned, hierarchyStatus };
}
