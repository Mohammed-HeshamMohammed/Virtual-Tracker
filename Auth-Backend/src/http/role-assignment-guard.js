import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";
import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { canAssignRole, canCreateMembers } from "./role-hierarchy.js";
import {
  OWNER_ASSIGN_BLOCKED_MESSAGE,
  validateOwnerRoleChange,
} from "./role-owner-policy.js";
import { getMemberParentId } from "../modules/member-relationships/service.js";
import {
  classifyHierarchyPlacement,
  roleChangeRequiresParentAssignment,
} from "../modules/hierarchy/hierarchy-placement.js";
import { hasIndependentHierarchyEntitlement } from "../modules/hierarchy/membership-entitlements.js";
import {
  canActorManageTargetRole,
  MEMBER_ROLE_MANAGE_DENIED_MESSAGE,
} from "./role-manage-policy.js";

/**
 * Resolve a role display name from optional name or Firestore role id.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ roleName?: string, roleId?: string }} input
 */
async function resolveTargetRoleName(db, input) {
  if (typeof input.roleName === "string" && input.roleName.trim()) {
    return input.roleName.trim();
  }
  if (typeof input.roleId === "string" && input.roleId.trim() && db) {
    const snap = await db.collection("roles").doc(input.roleId.trim()).get();
    if (snap.exists && typeof snap.data()?.name === "string") {
      return snap.data().name.trim();
    }
  }
  return "";
}

/**
 * Ensure the authenticated actor may assign the requested role.
 * Roles are never trusted from the client without privilege checks.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} actorRoleName
 * @param {{ roleName?: string, roleId?: string }} target
 * @returns {Promise<string | null>} error message or null when allowed
 */
export async function validateRoleAssignment(db, actorRoleName, target) {
  const targetRoleName = await resolveTargetRoleName(db, target);
  if (!targetRoleName) return null;

  const targetKey = normalizeRoleKey(targetRoleName);
  if (targetKey === "owner") {
    return OWNER_ASSIGN_BLOCKED_MESSAGE;
  }

  if ((targetKey === "admin" || targetKey === "superadmin") && normalizeRoleKey(actorRoleName) !== "owner") {
    return "Only an Owner can assign Admin or Super Admin roles.";
  }

  if (!canCreateMembers(actorRoleName)) {
    return "Insufficient permissions to assign roles.";
  }
  if (!canAssignRole(actorRoleName, targetRoleName)) {
    return "You cannot assign a role with higher privileges than your own.";
  }

  return null;
}

/**
 * Validates role change for a specific member (Owner protection + privilege ceiling).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} nextRoleName
 * @param {string} actorRoleName
 * @returns {Promise<string | null>}
 */
export async function validateMemberRoleChange(db, memberId, nextRoleName, actorRoleName) {
  const trimmed = typeof nextRoleName === "string" ? nextRoleName.trim() : "";
  if (!trimmed) return null;

  const currentRoleName = await resolveMemberRoleName(db, memberId);
  const ownerErr = validateOwnerRoleChange(currentRoleName, trimmed);
  if (ownerErr) return ownerErr;

  if (!canActorManageTargetRole(actorRoleName, currentRoleName)) {
    return MEMBER_ROLE_MANAGE_DENIED_MESSAGE;
  }

  const assignErr = await validateRoleAssignment(db, actorRoleName, { roleName: trimmed });
  if (assignErr) return assignErr;

  const memberSnap = await db.collection("members").doc(memberId).get();
  const memberData = memberSnap.exists ? memberSnap.data() : {};
  const parentId = await getMemberParentId(db, memberId);

  if (
    roleChangeRequiresParentAssignment(trimmed, parentId, memberData) &&
    !hasIndependentHierarchyEntitlement(memberData)
  ) {
    const placement = classifyHierarchyPlacement(trimmed, parentId, memberData);
    if (placement === "invalid") {
      const actorKey = normalizeRoleKey(actorRoleName);
      const isAdminActor =
        actorKey === "owner" || actorKey === "superadmin" || actorKey === "admin";
      if (!isAdminActor) {
        return "This role requires hierarchy assignment. Contact an administrator.";
      }
    }
  }

  return null;
}

/**
 * Apply hierarchy side effects after a successful role change.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} nextRoleName
 * @param {string} actorMemberId
 * @param {string} actorRoleName
 */
export async function applyRoleChangeHierarchy(db, memberId, nextRoleName, actorMemberId, actorRoleName) {
  const { applyRoleChangeHierarchyEffects } = await import("../modules/hierarchy/hierarchy-sync.js");
  return applyRoleChangeHierarchyEffects(db, {
    memberId,
    nextRoleName,
    actorMemberId,
    actorRoleName,
    deferBackground: true,
  });
}
