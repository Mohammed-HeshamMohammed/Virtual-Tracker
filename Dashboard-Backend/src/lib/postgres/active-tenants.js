import { queryAsAdmin } from "./client.js";

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
