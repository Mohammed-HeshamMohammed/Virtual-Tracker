import { normalizeRoleKey } from "../members/services/relation-sync.js";
import { isAdminLevelRole } from "../../http/role-hierarchy.js";

/**
 * The project modal's Management tab, enforced.
 *
 * Two kinds of switch live there, both on the project row:
 *
 * - **Who can change an area.** Off means a plain manager on the project sees
 *   that area read-only; only the people who see the Management tab (Owner,
 *   Super Admin, Admin, Super Manager) can still change it. The checks run on
 *   every write endpoint for the area, so locking is not just a greyed-out UI.
 * - **Whether an area is used at all.** Off means the project has no budget,
 *   or no member limits, as far as tracking, reports and the Projects table are
 *   concerned. The stored rows are kept, so switching it back on restores them.
 *
 * Every switch defaults to on, so nothing changes for existing projects.
 */

/** Area -> the column that says whether plain managers may change it. */
export const PROJECT_EDIT_AREAS = {
  budget: "managers_can_edit_budget",
  memberLimits: "managers_can_edit_member_limits",
  members: "managers_can_edit_members",
};

/** Request field (camelCase, as the dashboard sends it) -> column. */
export const PROJECT_RULE_FIELDS = {
  managersCanEditBudget: "managers_can_edit_budget",
  managersCanEditMemberLimits: "managers_can_edit_member_limits",
  managersCanEditMembers: "managers_can_edit_members",
  budgetEnabled: "budget_enabled",
  memberLimitsEnabled: "member_limits_enabled",
};

const AREA_LOCKED_MESSAGES = {
  budget: "An admin has locked this project's budget. Only admins and super managers can change it.",
  memberLimits: "An admin has locked this project's member limits. Only admins and super managers can change them.",
  members: "An admin has locked who is on this project. Only admins and super managers can change its members and teams.",
};

/** The people who see the Management tab - the same set as the dashboard's canManageProjectTracking. */
export function canManageProjectRules(roleName) {
  return isAdminLevelRole(roleName) || normalizeRoleKey(roleName) === "supermanager";
}

/** Whether `roleName` is kept from changing `area` on this project. */
export function isProjectAreaLocked(project, area, roleName) {
  if (canManageProjectRules(roleName)) return false;
  const column = PROJECT_EDIT_AREAS[area];
  return Boolean(column) && project?.[column] === false;
}

export function projectAreaLockedMessage(area) {
  return AREA_LOCKED_MESSAGES[area] ?? "An admin has locked this part of the project.";
}

/**
 * The Management switches present in a create/update body, as `{ camelKey: boolean }`.
 * Accepts camelCase or snake_case; anything absent is left out (undefined = leave alone).
 */
export function readProjectRuleFields(body) {
  const out = {};
  for (const [camel, snake] of Object.entries(PROJECT_RULE_FIELDS)) {
    const value = body?.[camel] ?? body?.[snake];
    if (value === undefined || value === null) continue;
    out[camel] = value !== false;
  }
  return out;
}
