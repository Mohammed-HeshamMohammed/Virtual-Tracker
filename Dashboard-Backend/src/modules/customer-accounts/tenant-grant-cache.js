import { query } from "../../lib/postgres/client.js";

/**
 * §4.3, §16.4: the one definition of "may this tenant be used right now".
 * Lives here (not tenant.service.js) so this file has no dependency on it -
 * tenant.service.js imports invalidateTenantGrantCache below to bust the
 * cache from inside its own mutations (renew, seats, and critically
 * removal's step 1), and a dependency the other direction would be a cycle.
 */
export async function getTenantGrant(tenantId) {
  const rows = await query(
    `SELECT id, type, granted_role, seat_limit, period_end, lifecycle
     FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/**
 * PLAN-customer-accounts-and-tenancy.md §16.4: the Enterprise role grant,
 * re-validated on every request the same way privileged-role-governance.js
 * re-validates Admin/Super Admin - except a subscription expiry must never
 * mutate the member's stored role (§4.3), so this only ever answers
 * "honored right now", it never writes anything back.
 *
 * Caches the RAW ROW, never the computed `active` boolean - tenant_is_active
 * depends on now(), so caching the verdict would keep honoring an expired
 * grant for the length of the TTL. Recomputing from a cached period_end on
 * every read is exact and costs nothing extra.
 */
const TTL_MS = 15 * 1000;
const cache = new Map();

function isActive(row) {
  return row.lifecycle === "live" && Date.now() < new Date(row.period_end).getTime();
}

export async function resolveTenantGrantCached(tenantId) {
  if (!tenantId) return null;
  const now = Date.now();
  const hit = cache.get(tenantId);
  const row = hit && hit.expiresAt > now ? hit.row : await getTenantGrant(tenantId);
  if (!hit || hit.expiresAt <= now) {
    if (!row) return null;
    cache.set(tenantId, { row, expiresAt: now + TTL_MS });
  }
  if (!row) return null;
  return { ...row, active: isActive(row) };
}

/** Called by tenant.service.js right after renew/seats/remove so the new
 *  period_end or lifecycle takes effect immediately - "renewal restores
 *  access immediately", not "within 15 seconds". */
export function invalidateTenantGrantCache(tenantId) {
  if (tenantId) cache.delete(tenantId);
}

export function clearTenantGrantCache() {
  cache.clear();
}
