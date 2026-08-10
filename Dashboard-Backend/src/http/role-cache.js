import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { subscribeChanges } from "../modules/realtime/change-bus.js";

const TTL_MS = 15 * 1000;
/** @type {Map<string, { roleName: string, expiresAt: number }>} */
const cache = new Map();

subscribeChanges((msg) => {
  if (msg.resource === "members" && msg.id) {
    cache.delete(msg.id);
  } else if (msg.resource === "roles") {
    cache.clear();
  }
});

/** Role name with 15s in-process cache (invalidated instantly on change-bus updates). */
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

