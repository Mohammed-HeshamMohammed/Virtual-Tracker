import { queryAsAdmin, withTenant } from "./client.js";

/**
 * §0.2 step 4: the enumeration a background sweep needs before it can loop
 * per tenant (client.js's withTenant() runs one tenant's worth of work -
 * something has to supply the list). Runs on the vt_admin identity since a
 * sweep has no request tenant of its own to see past RLS with.
 *
 * includeInactive defaults to true because most sweeps (reaping abandoned
 * sessions, integrity checks) should still run for a tenant whose period
 * just lapsed - only data-retention's own ACTIVE_TENANT_FILTER decides who
 * gets skipped for that specific reason.
 */
export async function listActiveTenantIds({ includeInactive = true } = {}) {
  const rows = await queryAsAdmin(
    includeInactive
      ? `SELECT id FROM tenants WHERE lifecycle IN ('live', 'removing')`
      : `SELECT id FROM tenants WHERE lifecycle = 'live' AND now() < period_end`,
  );
  return rows.map((r) => r.id);
}

/**
 * Runs fn once per tenant, each inside its own withTenant() frame - the
 * shape every background job needs, since a job has no request to carry a
 * tenant. Tenants run one after another, and one tenant's failure is
 * logged-and-skipped rather than stopping the rest.
 */
export async function forEachActiveTenant(fn, { includeInactive = true, label = "background job" } = {}) {
  const results = [];
  for (const tenantId of await listActiveTenantIds({ includeInactive })) {
    try {
      results.push(await withTenant(tenantId, () => fn(tenantId)));
    } catch (err) {
      console.warn(`[${label}] failed for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}
