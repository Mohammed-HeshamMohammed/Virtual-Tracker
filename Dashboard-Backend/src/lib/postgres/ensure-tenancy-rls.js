import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { getEnv } from "../../config/env.js";
import { TENANT_SCOPED_TABLES } from "./tenancy-tables.js";

/**
 * PLAN-customer-accounts-and-tenancy.md §3, §12.2 #4: enabling RLS is a
 * one-way deploy - rolling it back after real customers exist means losing
 * isolation, not just flipping a flag. It stays OFF by default and only
 * this repo's tests / an operator who has read that section turn it on,
 * after a staging soak with production-shaped data.
 *
 * Turning this on ALSO requires an operational step this migration cannot
 * perform itself: the application's own POSTGRES_URL has to become a
 * connection AS vt_app (or vt_readonly_crosstenant / vt_admin for their
 * respective call sites), not the table owner it connects as today - table
 * owners bypass RLS regardless of ENABLE/FORCE, by Postgres design. Until
 * that connection-string change happens in the deploy environment, this
 * migration's roles and policies exist and are correct, but the app's own
 * queries are unaffected by them. That is the intended staged rollout, not
 * a bug: policies can be created, reviewed and soaked in staging entirely
 * before the connection cutover that makes them load-bearing.
 */
export function isTenancyRlsEnabled() {
  return getEnv().postgres.tenancyRlsEnabled === true;
}

const TABLE_NAMES = TENANT_SCOPED_TABLES.map((e) => (typeof e === "string" ? e : e.name));

const ROLE_DDL = [
  // CREATEROLE privilege is assumed on the connection running this (the
  // same connection that already runs the rest of schema bootstrap, which
  // creates roles/permissions rows and functions - an equivalent level of
  // trust). NOLOGIN roles are not needed here: all three are meant to be
  // connected to directly via their own connection strings.
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vt_app') THEN
    CREATE ROLE vt_app LOGIN PASSWORD NULL;
  END IF;
END $$`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vt_readonly_crosstenant') THEN
    CREATE ROLE vt_readonly_crosstenant LOGIN PASSWORD NULL;
  END IF;
END $$`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vt_admin') THEN
    CREATE ROLE vt_admin LOGIN PASSWORD NULL BYPASSRLS;
  END IF;
END $$`,
  // BYPASSRLS is also asserted on every run (not just at creation) in case
  // an operator created the role manually without it.
  "ALTER ROLE vt_admin BYPASSRLS",
  "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vt_admin",
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vt_admin",
  "GRANT USAGE ON SCHEMA public TO vt_app, vt_readonly_crosstenant, vt_admin",
  "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vt_app",
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vt_app",
  // §3.1, §8: no write grant at all, at the database level - a future write
  // feature literally cannot become available to Owners inside a customer
  // tenant through this role, regardless of what application code does.
  "GRANT SELECT ON ALL TABLES IN SCHEMA public TO vt_readonly_crosstenant",
];

function policyDdlForTable(table) {
  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    // FORCE matters because vt_app and vt_readonly_crosstenant are NOT the
    // table owner (vt_admin/the bootstrap role is) - ENABLE alone exempts
    // the owner, FORCE closes that exemption too, belt and braces even
    // though neither of those two roles owns these tables.
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS tenant_isolation ON ${table}`,
    // NULLIF(...,'')::uuid rather than a bare cast: an unset GUC is '' from
    // current_setting(_, true), and '' :: uuid throws - NULLIF turns that
    // into a clean NULL, and NULL = anything is NULL (not true), so a
    // connection with no tenant published sees nothing. Fails closed.
    `CREATE POLICY tenant_isolation ON ${table}
       USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`,
  ];
}

const RLS_POLICY_DDL = TABLE_NAMES.flatMap(policyDdlForTable);

export async function ensureTenancyRls() {
  if (!isTenancyRlsEnabled()) {
    return { ok: true, skipped: true, reason: "POSTGRES_TENANCY_RLS_ENABLED is not set" };
  }
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }
  const pool = getPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  const client = await pool.connect();
  try {
    for (const statement of [...ROLE_DDL, ...RLS_POLICY_DDL]) {
      await client.query(statement);
    }
    return { ok: true, tablesCovered: TABLE_NAMES.length };
  } catch (err) {
    logSafeWarn("[postgres] ensure tenancy RLS failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

/** Exposed for the coverage test (§11): every table that exists in the
 *  database and is not in GLOBAL_TABLES must appear here, or it silently
 *  gets no RLS policy when this migration runs. */
export function listRlsCoveredTableNames() {
  return [...TABLE_NAMES];
}
