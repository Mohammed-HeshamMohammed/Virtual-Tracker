import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";

const TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { roleName: string, expiresAt: number }>} */
const cache = new Map();

/**
 * Resolve member role with a short in-process TTL to avoid 3+ Firestore reads per request.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function resolveMemberRoleNameCached(db, memberId) {
  if (!memberId) return "Viewer";
  const now = Date.now();
  const hit = cache.get(memberId);
  if (hit && hit.expiresAt > now) return hit.roleName;

  const roleName = await resolveMemberRoleName(db, memberId);
  cache.set(memberId, { roleName, expiresAt: now + TTL_MS });
  return roleName;
}

/** @param {string} memberId */
export function invalidateMemberRoleCache(memberId) {
  if (memberId) cache.delete(memberId);
}

export function clearMemberRoleCache() {
  cache.clear();
}
