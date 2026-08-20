import {
  normalizeRoleKey,
  rolePrivilegeRank,
  ROLE_PRIVILEGE_RANK,
} from "../modules/members/services/relation-sync.js";

/** Display names assignable through the product (Owner excluded from UI assignment). */
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

/**
 * @param {string} roleName
 */
export function isAdminLevelRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "admin" || key === "superadmin" || key === "owner";
}

/**
 * @param {string} roleName
 */
export function isOwnerOrSuperAdminRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin";
}

/**
 * @param {string} roleName
 */
export function isDeactivationApprovalRole(roleName) {
  return isAdminLevelRole(roleName);
}

/**
 * Employee tiers whose deactivation requests are governed by Admin / Super Admin / Owner.
 * @param {string} roleName
 */
export function isEmployeeRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "intern" || key === "employee" || key === "teamlead";
}

/**
 * Deactivation requests from these roles are routed only to Admin / Super Admin / Owner.
 * @param {string} roleName
 */
export function requiresAdminDeactivationGovernance(roleName) {
  return isEmployeeRole(roleName) || normalizeRoleKey(roleName) === "client";
}

/**
 * Non-viewer accounts that must submit deactivation requests (not self-delete).
 * @param {string} roleName
 */
export function requiresDeactivationRequest(roleName) {
  const key = normalizeRoleKey(roleName);
  return key !== "viewer" && key !== "user";
}

/** Persisted on `members` when role governance for deactivation is assigned. */
export function deactivationGovernanceForRole(roleName) {
  if (normalizeRoleKey(roleName) === "viewer") return "self_delete";
  if (requiresAdminDeactivationGovernance(roleName) || isEmployeeRole(roleName)) {
    return "admin_hierarchy";
  }
  return "admin_hierarchy";
}

/**
 * Management roles that may create or invite members.
 * @param {string} roleName
 */
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

/**
 * Highest privilege rank the actor may assign when adding or editing members.
 * @param {string} actorRoleName
 */
export function maxAssignableRank(actorRoleName) {
  const actorKey = normalizeRoleKey(actorRoleName);
  const actorRank = rolePrivilegeRank(actorRoleName);
  if (actorKey === "owner") return ROLE_PRIVILEGE_RANK.superadmin;
  if (!canCreateMembers(actorRoleName)) return -1;
  return actorRank - 10;
}

/**
 * @param {string} actorRoleName
 * @param {string} targetRoleName
 */
export function canAssignRole(actorRoleName, targetRoleName) {
  const targetKey = normalizeRoleKey(targetRoleName);
  if (targetKey === "owner") return false;
  if (!canCreateMembers(actorRoleName)) return false;
  const targetRank = rolePrivilegeRank(targetRoleName);
  if (targetRank < 0) return false;
  return targetRank <= maxAssignableRank(actorRoleName);
}

/**
 * @param {string} actorRoleName
 * @returns {string[]}
 */
export function listAssignableRoleNames(actorRoleName) {
  return ASSIGNABLE_ROLE_NAMES.filter((name) => canAssignRole(actorRoleName, name));
}
