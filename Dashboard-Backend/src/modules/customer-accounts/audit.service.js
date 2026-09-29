import { queryAsAdmin } from "../../lib/postgres/client.js";

/**
 * Account actions (create, renew, seats, removed) and data views, all in
 * customer_account_audit - separate from the row-level audit_logs trigger
 * table (§9, §14.3): that one captures row CHANGES automatically, this one
 * captures actions including reads, which no trigger can see, and it is
 * deliberately not a foreign key to tenants(id) so removal never erases the
 * record that it happened.
 *
 * customer_account_audit is a control-plane table (tenancy-tables.js's
 * CONTROL_PLANE_TABLES) - vt_app has zero grants on it once RLS's grant
 * scope is narrowed (§0.1 blocker 2), so this always writes on the admin
 * identity, matching every other function in this module.
 */
export async function recordCustomerAccountAudit({ tenantId, actorId, action, detail = {} }) {
  await queryAsAdmin(
    `INSERT INTO customer_account_audit (tenant_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tenantId, actorId, action, JSON.stringify(detail ?? {})],
  );
}
