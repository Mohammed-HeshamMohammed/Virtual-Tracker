import { normalizeRoleKey } from "./relation-sync.js";
import { isEmployeeRole } from "../../../core/middleware/auth/role-hierarchy.js";
import { hasIndependentHierarchyEntitlement } from "./hierarchy-membership-entitlements.js";

/** @typedef {"unassigned" | "assigned" | "hierarchy_assignment_required" | "external"} HierarchyStatus */

export const HIERARCHY_STATUS = Object.freeze({
  unassigned: "unassigned",
  assigned: "assigned",
  hierarchy_assignment_required: "hierarchy_assignment_required",
  /** Client and other external entities — outside org hierarchy entirely */
  external: "external",
});

/** Sole unconditional org tree root. */
const ORG_ROOT_ROLE_KEYS = new Set(["owner"]);

/** Admin roles that belong under Owner in the org tree (not separate roots). */
const ORG_ADMIN_ROLE_KEYS = new Set(["superadmin", "admin"]);

/** Independent users — not organizational subtree members. */
const ALWAYS_INDEPENDENT_ROLE_KEYS = new Set([
  "viewer",
  "user",
]);

/** Category 4 — external entities; never in member trees. */
const EXTERNAL_ENTITY_ROLE_KEYS = new Set(["client"]);

/** Roles that may be hierarchy roots only with membership entitlement. */
const CONDITIONAL_ROOT_ROLE_KEYS = new Set(["manager", "supermanager", "supermanger"]);

/** Roles that must always have a parent unless admin root roles. */
const REQUIRES_PARENT_ROLE_KEYS = new Set([
  "employeel0",
  "employeel1",
  "employeel2",
  "employee",
]);

/**
 * Category 4 — external entities (Clients). Not hierarchy members or roots.
 * @param {string} roleName
 */
export function isExternalEntityRole(roleName) {
  return EXTERNAL_ENTITY_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * Whether this role is excluded from all hierarchy validation, repair, and trees.
 * @param {string} roleName
 */
export function isExcludedFromHierarchy(roleName) {
  return isExternalEntityRole(roleName);
}

/**
 * @param {string} roleName
 */
export function isAlwaysIndependentRole(roleName) {
  return ALWAYS_INDEPENDENT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * Super Admin / Admin — organizational admins that must appear under Owner in the tree.
 * @param {string} roleName
 */
export function isOrganizationAdminRole(roleName) {
  return ORG_ADMIN_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * Owner — sole canonical org tree root.
 * @param {string} roleName
 */
export function isOrganizationRootRole(roleName) {
  return ORG_ROOT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * @param {string} roleName
 */
export function isConditionalHierarchyRootRole(roleName) {
  return CONDITIONAL_ROOT_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * @param {string} roleName
 */
export function roleRequiresParent(roleName) {
  if (isExcludedFromHierarchy(roleName)) return false;
  const key = normalizeRoleKey(roleName);
  if (REQUIRES_PARENT_ROLE_KEYS.has(key)) return true;
  if (isConditionalHierarchyRootRole(roleName)) return true;
  return false;
}

/**
 * Classify hierarchy placement for a member.
 *
 * @param {string} roleName
 * @param {string | null | undefined} parentMemberId
 * @param {Record<string, unknown> | null | undefined} memberData
 * @returns {"independent" | "hierarchy_member" | "hierarchy_root" | "invalid" | "external"}
 */
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

/**
 * Resolve the hierarchy_status field value for a member.
 *
 * @param {string} roleName
 * @param {string | null | undefined} parentMemberId
 * @param {Record<string, unknown> | null | undefined} memberData
 * @returns {HierarchyStatus}
 */
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

/**
 * Whether a role change requires establishing a parent relationship.
 *
 * @param {string} nextRoleName
 * @param {string | null | undefined} parentMemberId
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function roleChangeRequiresParentAssignment(nextRoleName, parentMemberId, memberData = null) {
  if (isExcludedFromHierarchy(nextRoleName)) return false;
  const placement = classifyHierarchyPlacement(nextRoleName, parentMemberId, memberData);
  return placement === "invalid";
}

/**
 * Roles that may initiate member transfer (recruitment) requests.
 *
 * @param {string} roleName
 */
export function canCreateTransferRequests(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "manager" || key === "supermanager" || key === "supermanger";
}

/**
 * Whether the member is in a state that restricts organizational access.
 *
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function hasHierarchyAssignmentRestriction(memberData) {
  return memberData?.hierarchy_status === HIERARCHY_STATUS.hierarchy_assignment_required;
}

/**
 * Validate whether a target member can be recruited via transfer request.
 *
 * @param {string} targetRoleName
 * @param {string | null | undefined} targetParentId
 * @param {Record<string, unknown> | null | undefined} targetMemberData
 */
export function isValidTransferTarget(targetRoleName, targetParentId, targetMemberData = null) {
  if (isExcludedFromHierarchy(targetRoleName)) return false;

  const key = normalizeRoleKey(targetRoleName);
  if (key === "owner" || key === "superadmin" || key === "admin") return false;

  const placement = classifyHierarchyPlacement(targetRoleName, targetParentId, targetMemberData);
  if (placement === "independent") return true;
  if (placement === "hierarchy_member") return true;
  return false;
}

/**
 * @param {string} roleName
 */
export function isOrphanEmployeeViolation(roleName, parentMemberId) {
  if (isExcludedFromHierarchy(roleName)) return false;
  return isEmployeeRole(roleName) && !(typeof parentMemberId === "string" && parentMemberId.trim());
}
