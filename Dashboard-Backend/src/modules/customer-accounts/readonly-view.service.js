import { queryAsReadonlyCrossTenant } from "../../lib/postgres/client.js";

/**
 * §0.1 blocker 7 / §0.2 step 5: the audited cross-tenant read-only view
 * (US-5's "view this account's data") - a small ALLOWLISTED query surface,
 * not a generic tenant-switch primitive. Every function here runs on
 * vt_readonly_crosstenant, which cannot write at the grant level regardless
 * of what this code does (ensure-tenancy-rls.js's `GRANT SELECT`, no write
 * grant at all) - the allowlist below is what limits WHICH tables are
 * visible, the grant is what makes writes structurally impossible even if
 * this file had a bug.
 */

export async function listCustomerProjects(tenantId) {
  return queryAsReadonlyCrossTenant(
    tenantId,
    `SELECT id, name, status, billable, type, client_id, end_date, created_at
     FROM projects WHERE tenant_id = $1
     ORDER BY created_at DESC LIMIT 500`,
    [tenantId],
  );
}

export async function listCustomerEmployees(tenantId) {
  return queryAsReadonlyCrossTenant(
    tenantId,
    `SELECT id, first_name, last_name, display_name, work_email, status, created_at
     FROM members WHERE tenant_id = $1
     ORDER BY created_at DESC LIMIT 500`,
    [tenantId],
  );
}

export async function getCustomerActivitySummary(tenantId) {
  const rows = await queryAsReadonlyCrossTenant(
    tenantId,
    `SELECT
       (SELECT count(*) FROM members WHERE tenant_id = $1 AND status = 'active') AS active_members,
       (SELECT count(*) FROM projects WHERE tenant_id = $1 AND status = 'active') AS active_projects,
       (SELECT COALESCE(sum(active_seconds), 0) FROM daily_member_active_seconds
          WHERE tenant_id = $1 AND day >= (current_date - interval '7 days')) AS active_seconds_7d`,
    [tenantId],
  );
  return rows[0] ?? null;
}
