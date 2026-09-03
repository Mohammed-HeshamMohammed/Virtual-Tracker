import {
  normalizeRoleKey,
  rolePrivilegeRank,
  ROLE_PRIVILEGE_RANK,
} from "../modules/members/services/relation-sync.js";

export const ASSIGNABLE_ROLE_NAMES = [
  "Super Admin",
  "Admin",
  "Super Manager",
  "Manager",
  "Team Lead",
  "Employee",
  "Intern",
  "Client",
  "Viewer",
];

export function isAdminLevelRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "admin" || key === "superadmin" || key === "owner";
}

export function isOwnerOrSuperAdminRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin";
}

export function isDeactivationApprovalRole(roleName) {
  return isAdminLevelRole(roleName);
}

export function isEmployeeRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "intern" || key === "employee" || key === "teamlead";
}

export function requiresAdminDeactivationGovernance(roleName) {
  return isEmployeeRole(roleName) || normalizeRoleKey(roleName) === "client";
}

export function isViewerRole(roleName) {
  return normalizeRoleKey(roleName) === "viewer";
}

export function requiresDeactivationRequest(roleName) {
  const key = normalizeRoleKey(roleName);
  return key !== "viewer" && key !== "user";
}

export function deactivationGovernanceForRole(roleName) {
  if (normalizeRoleKey(roleName) === "viewer") return "self_delete";
  if (requiresAdminDeactivationGovernance(roleName) || isEmployeeRole(roleName)) {
    return "admin_hierarchy";
  }
  return "admin_hierarchy";
}

export function canCreateMembers(roleName) {
  const key = normalizeRoleKey(roleName);
  return (
    key === "owner" ||
    key === "superadmin" ||
    key === "admin" ||
    key === "supermanager" ||
    key === "manager"
  );
}

export function maxAssignableRank(actorRoleName) {
  const actorKey = normalizeRoleKey(actorRoleName);
  const actorRank = rolePrivilegeRank(actorRoleName);
  if (actorKey === "owner") return ROLE_PRIVILEGE_RANK.superadmin;
  if (!canCreateMembers(actorRoleName)) return -1;
  return actorRank - 10;
}

export function canAssignRole(actorRoleName, targetRoleName) {
  const targetKey = normalizeRoleKey(targetRoleName);
  if (targetKey === "owner") return false;
  if (!canCreateMembers(actorRoleName)) return false;
  const targetRank = rolePrivilegeRank(targetRoleName);
  if (targetRank < 0) return false;
  return targetRank <= maxAssignableRank(actorRoleName);
}

export function listAssignableRoleNames(actorRoleName) {
  return ASSIGNABLE_ROLE_NAMES.filter((name) => canAssignRole(actorRoleName, name));
}
