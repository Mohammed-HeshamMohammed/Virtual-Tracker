export const ASSIGNABLE_ROLE_NAMES = [
  "Super Admin",
  "Admin",
  "Super Manager",
  "Manager",
  "Employee L2",
  "Employee L1",
  "Employee L0",
  "Client",
  "Viewer",
];

export const ROLE_PRIVILEGE_RANK = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  employeel2: 50,
  employeel1: 40,
  employeel0: 30,
  employee: 30,
  client: 20,
  viewer: 10,
};

export function normalizeRoleKey(roleName) {
  return typeof roleName === "string" ? roleName.trim().toLowerCase().replace(/\s+/g, "") : "";
}

export function rolePrivilegeRank(roleName) {
  const key = normalizeRoleKey(roleName);
  if (!key) return -1;
  return ROLE_PRIVILEGE_RANK[key] ?? 35;
}

export function isAdminLevelRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "admin" || key === "superadmin" || key === "owner";
}

export function isDeactivationApprovalRole(roleName) {
  return isAdminLevelRole(roleName);
}

export function isEmployeeRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return (
    key === "employeel0" ||
    key === "employeel1" ||
    key === "employeel2" ||
    key === "employee"
  );
}

export function requiresAdminDeactivationGovernance(roleName) {
  return isEmployeeRole(roleName) || normalizeRoleKey(roleName) === "client";
}

export function requiresDeactivationRequest(roleName) {
  const key = normalizeRoleKey(roleName);
  return key !== "viewer" && key !== "user";
}

export function deactivationGovernanceForRole(roleName) {
  if (normalizeRoleKey(roleName) === "viewer") return "self_delete";
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
