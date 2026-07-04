import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

export const OWNER_ROLE_LOCKED_MESSAGE =
  "The Owner role cannot be changed through the application.";

export const OWNER_ASSIGN_BLOCKED_MESSAGE =
  "Cannot assign the Owner role through the application interface. It must be modified in the database directly.";

export const OWNER_REMOVE_BLOCKED_MESSAGE =
  "The Owner account cannot be removed through the application.";

/**
 * @param {string} roleName
 */
export function isOwnerRole(roleName) {
  return normalizeRoleKey(roleName) === "owner";
}

/** Block Owner role changes/assignments via API. */
export function validateOwnerRoleChange(currentRoleName, nextRoleName) {
  const next = typeof nextRoleName === "string" ? nextRoleName.trim() : "";
  if (!next) return null;

  const currentKey = normalizeRoleKey(currentRoleName);
  const nextKey = normalizeRoleKey(next);
  if (currentKey === nextKey) return null;

  if (currentKey === "owner") return OWNER_ROLE_LOCKED_MESSAGE;
  if (nextKey === "owner") return OWNER_ASSIGN_BLOCKED_MESSAGE;

  return null;
}
