import { query } from "../../lib/postgres/client.js";

/**
 * Account actions (create, renew, seats, removed) and data views, all in
 * customer_account_audit - separate from the row-level audit_logs trigger
 * table (§9, §14.3): that one captures row CHANGES automatically, this one
 * captures actions including reads, which no trigger can see, and it is
 * deliberately not a foreign key to tenants(id) so removal never erases the
 * record that it happened.
 */
export async function recordCustomerAccountAudit({ tenantId, actorId, action, detail = {} }) {
  await query(
    `INSERT INTO customer_account_audit (tenant_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tenantId, actorId, action, JSON.stringify(detail ?? {})],
  );
}
