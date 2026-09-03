import { normalizeRoleKey } from "../members/services/relation-sync.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";
import { hasIndependentHierarchyEntitlement } from "./membership-entitlements.js";


export const HIERARCHY_STATUS = Object.freeze({
  unassigned: "unassigned",
  assigned: "assigned",
  hierarchy_assignment_required: "hierarchy_assignment_required",
  external: "external",
});

const ORG_ROOT_ROLE_KEYS = new Set(["owner"]);

const ORG_ADMIN_ROLE_KEYS = new Set(["superadmin", "admin"]);

const ALWAYS_INDEPENDENT_ROLE_KEYS = new Set([
  "viewer",
  "user",
]);

const EXTERNAL_ENTITY_ROLE_KEYS = new Set(["client"]);

const CONDITIONAL_ROOT_ROLE_KEYS = new Set(["manager", "supermanager", "supermanger"]);

const REQUIRES_PARENT_ROLE_KEYS = new Set([
  "intern",
  "employee",
  "teamlead",
]);

export function isExternalEntityRole(roleName) {
  return EXTERNAL_ENTITY_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

export function isExcludedFromHierarchy(roleName) {
  return isExternalEntityRole(roleName);
}

export function isAlwaysIndependentRole(roleName) {
  return ALWAYS_INDEPENDENT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

export function isOrganizationAdminRole(roleName) {
  return ORG_ADMIN_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

export function isOrganizationRootRole(roleName) {
  return ORG_ROOT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

export function isConditionalHierarchyRootRole(roleName) {
  return CONDITIONAL_ROOT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

export function roleRequiresParent(roleName) {
  if (isExcludedFromHierarchy(roleName)) return false;
  const key = normalizeRoleKey(roleName);
  if (REQUIRES_PARENT_ROLE_KEYS.has(key)) return true;
  if (isConditionalHierarchyRootRole(roleName)) return true;
  return false;
}

export function classifyHierarchyPlacement(roleName, parentMemberId, memberData = null) {
  if (isExcludedFromHierarchy(roleName)) {
    return "external";
  }

  const key = normalizeRoleKey(roleName);
  const hasParent = typeof parentMemberId === "string" && parentMemberId.trim().length > 0;

  if (ORG_ROOT_ROLE_KEYS.has(key)) {
    return "independent";
  }

  if (ORG_ADMIN_ROLE_KEYS.has(key)) {
    return hasParent ? "hierarchy_member" : "invalid";
  }

  if (isAlwaysIndependentRole(roleName)) {
    return "independent";
  }

  if (REQUIRES_PARENT_ROLE_KEYS.has(key)) {
    return hasParent ? "hierarchy_member" : "invalid";
  }

  if (isConditionalHierarchyRootRole(roleName)) {
    if (hasParent) return "hierarchy_member";
    if (hasIndependentHierarchyEntitlement(memberData)) return "hierarchy_root";
    return "invalid";
  }

  return hasParent ? "hierarchy_member" : "independent";
}

export function resolveHierarchyStatus(roleName, parentMemberId, memberData = null) {
  const placement = classifyHierarchyPlacement(roleName, parentMemberId, memberData);

  if (placement === "external") {
    return HIERARCHY_STATUS.external;
  }

  if (placement === "invalid") {
    return HIERARCHY_STATUS.hierarchy_assignment_required;
  }

  if (placement === "independent" || placement === "hierarchy_root") {
    const key = normalizeRoleKey(roleName);
    if (key === "viewer" || key === "user") {
      return HIERARCHY_STATUS.unassigned;
    }
    return HIERARCHY_STATUS.assigned;
  }

  return HIERARCHY_STATUS.assigned;
}

export function roleChangeRequiresParentAssignment(nextRoleName, parentMemberId, memberData = null) {
  if (isExcludedFromHierarchy(nextRoleName)) return false;
  const placement = classifyHierarchyPlacement(nextRoleName, parentMemberId, memberData);
  return placement === "invalid";
}

export function canCreateTransferRequests(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "manager" || key === "supermanager" || key === "supermanger";
}

export function hasHierarchyAssignmentRestriction(memberData) {
  return memberData?.hierarchy_status === HIERARCHY_STATUS.hierarchy_assignment_required;
}

export function isValidTransferTarget(targetRoleName, targetParentId, targetMemberData = null) {
  if (isExcludedFromHierarchy(targetRoleName)) return false;

  const key = normalizeRoleKey(targetRoleName);
  if (key === "owner" || key === "superadmin" || key === "admin") return false;

  const placement = classifyHierarchyPlacement(targetRoleName, targetParentId, targetMemberData);
  if (placement === "independent") return true;
  if (placement === "hierarchy_member") return true;
  return false;
}

export function isOrphanEmployeeViolation(roleName, parentMemberId) {
  if (isExcludedFromHierarchy(roleName)) return false;
  return isEmployeeRole(roleName) && !(typeof parentMemberId === "string" && parentMemberId.trim());
}
