import { query } from "./client.js";
import { subscribeChanges } from "../../modules/realtime/change-bus.js";
import { currentTenantId } from "./audit-actor.js";
import { MAIN_TENANT_ID } from "./ensure-tenancy-schema.js";

/**
 * PLAN-customer-accounts-and-tenancy.md §15.8: `lookup_tables` and
 * `org_field_options` are tenant-scoped (job titles, departments, custom
 * field options a customer can edit), but this cache used to be a single
 * process-global entry with no tenant awareness at all - the first tenant
 * to populate it within a 15-second window would have their job titles and
 * employment-type options served to every OTHER tenant that read this cache
 * in that same window, regardless of RLS (RLS protects the database; it has
 * no say over a value already sitting in this process's memory - this is
 * the one hole in the isolation design that RLS structurally cannot cover).
 *
 * Fix: one cache entry per tenant, and the two tenant-scoped queries filter
 * by tenant_id explicitly (defense in depth - correct today, before RLS is
 * live, and still correct after). `roles` stays a single shared entry: it
 * is genuinely global (§15.5 - the platform's own role catalog, customers
 * use it rather than define it).
 */
const CACHE_TTL_MS = 15 * 1000;
/** @type {{ data: any, expiresAt: number } | null} */
let rolesCache = null;
/** @type {Map<string, { data: any, expiresAt: number }>} */
const perTenantCache = new Map();

subscribeChanges((msg) => {
  if (msg.resource === "roles") {
    rolesCache = null;
  } else if (msg.resource === "lookups" || msg.resource === "orgOptions") {
    // The change-bus event carries no tenant today, so this clears every
    // tenant's entry rather than risk leaving a stale one behind - a cache
    // miss just costs one extra query, unlike a wrongly-served entry.
    perTenantCache.clear();
  }
});

async function getRolesCached() {
  if (rolesCache && Date.now() < rolesCache.expiresAt) return rolesCache.data;
  const roles = await query("SELECT id, name, description, created_at, created_by, updated_by, updated_at FROM roles ORDER BY name");
  rolesCache = { data: roles, expiresAt: Date.now() + CACHE_TTL_MS };
  return roles;
}

export async function getLookupData() {
  const tenantId = currentTenantId() ?? MAIN_TENANT_ID;
  const hit = perTenantCache.get(tenantId);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.data;
  }

  try {
    const [roles, lookups, orgOptions] = await Promise.all([
      getRolesCached(),
      query(
        "SELECT category, id, name, list_ranking, created_at, created_by, updated_by, updated_at FROM lookup_tables WHERE tenant_id = $1 ORDER BY category, list_ranking, name",
        [tenantId],
      ),
      query(
        "SELECT type, id, label, position, created_at, updated_at, modified_by FROM org_field_options WHERE tenant_id = $1 ORDER BY type, position",
        [tenantId],
      ),
    ]);

    const data = { roles, lookups, orgOptions };
    perTenantCache.set(tenantId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    if (hit) return hit.data;
    return { roles: [], lookups: [], orgOptions: [] };
  }
}

export function invalidateLookupCache() {
  rolesCache = null;
  perTenantCache.clear();
}
