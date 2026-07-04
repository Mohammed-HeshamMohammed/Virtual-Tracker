import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/** Role keys each actor may not edit/remove (Owner handled separately). @type {Record<string, Set<string>>} */
const BLOCKED_TARGET_KEYS_BY_ACTOR = {
  owner: new Set(["owner"]),
  superadmin: new Set(["owner", "superadmin"]),
  admin: new Set(["owner", "superadmin"]),
  supermanager: new Set(["owner", "admin", "superadmin"]),
  supermanger: new Set(["owner", "admin", "superadmin"]),
  manager: new Set(["owner", "admin", "superadmin", "supermanager", "supermanger"]),
};

/**
 * Can actor mutate a member with targetRoleName? (scope checked elsewhere)
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
