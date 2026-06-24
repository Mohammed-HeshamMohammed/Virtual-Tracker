import { resolveMemberRoleName } from "../../../modules/shared/services/auth-helpers.js";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

export async function resolveMemberRoleNameCached(db, memberId) {
  if (!memberId) return "Viewer";
  const now = Date.now();
  const hit = cache.get(memberId);
  if (hit && hit.expiresAt > now) return hit.roleName;

  const roleName = await resolveMemberRoleName(db, memberId);
  cache.set(memberId, { roleName, expiresAt: now + TTL_MS });
  return roleName;
}

export function invalidateMemberRoleCache(memberId) {
  if (memberId) cache.delete(memberId);
}

export function clearMemberRoleCache() {
  cache.clear();
}
