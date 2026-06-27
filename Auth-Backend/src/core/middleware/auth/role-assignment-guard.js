import { normalizeRoleKey } from "../../../modules/shared/services/relation-sync.js";
import { canAssignRole, canCreateMembers } from "./role-hierarchy.js";
import { OWNER_ASSIGN_BLOCKED_MESSAGE } from "./role-owner-policy.js";

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
