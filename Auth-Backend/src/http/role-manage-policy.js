import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/**
 * Target role keys an actor may not edit or remove (by explicit product policy).
 * Owner is always protected separately via role-owner-policy.
 *
 * @type {Record<string, Set<string>>}
 */
const BLOCKED_TARGET_KEYS_BY_ACTOR = {
  owner: new Set(["owner"]),
  superadmin: new Set(["owner", "superadmin"]),
  admin: new Set(["owner", "superadmin"]),
  supermanager: new Set(["owner", "admin", "superadmin"]),
  supermanger: new Set(["owner", "admin", "superadmin"]),
  manager: new Set(["owner", "admin", "superadmin", "supermanager", "supermanger"]),
};

/**
 * Whether the actor may mutate a member who currently holds `targetRoleName`.
 * Scope checks (subtree, visibility) are enforced separately.
 *
 * @param {string} actorRoleName
 * @param {string} targetRoleName
 * @returns {boolean}
 */
export function canActorManageTargetRole(actorRoleName, targetRoleName) {
  const actorKey = normalizeRoleKey(actorRoleName);
  const targetKey = normalizeRoleKey(targetRoleName);
  if (!actorKey || !targetKey) return false;

  const blocked = BLOCKED_TARGET_KEYS_BY_ACTOR[actorKey];
  if (!blocked) return false;
  return !blocked.has(targetKey);
}

export const MEMBER_ROLE_MANAGE_DENIED_MESSAGE =
  "Insufficient permissions to modify this member.";
