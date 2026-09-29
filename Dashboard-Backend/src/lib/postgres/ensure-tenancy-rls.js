import { logSafeWarn } from "../../http/sanitize-error.js";
import { getAdminPostgresPool, isPostgresConfigured } from "./client.js";
import { getEnv } from "../../config/env.js";
import {
  TENANT_SCOPED_TABLES,
  TENANT_SCOPED_VIEWS,
  listGlobalTableNames,
  listControlPlaneTableNames,
} from "./tenancy-tables.js";
import { deriveRolePassword, scramVerifier } from "./role-credentials.js";

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
const GLOBAL_NAMES = listGlobalTableNames();
const CONTROL_PLANE_NAMES = listControlPlaneTableNames();

// vt_app's business surface: every scoped + global table, explicitly NOT
// the control-plane tables (tenants/verification_codes/
// customer_account_audit) - those are written only via queryAsAdmin
// (client.js), e.g. tenant.service.js. A previous version of this file
// granted ALL TABLES, which handed vt_app read/write on verification-code
// hashes and the tenant registry itself; this list is the fix.
const VT_APP_TABLE_NAMES = [...TABLE_NAMES, ...GLOBAL_NAMES];

// vt_readonly_crosstenant only ever needs to show an Owner another tenant's
// own business data (§0.2 step 5) - never global reference data (no reason
// to expose it cross-tenant) and never control-plane tables.
const VT_READONLY_TABLE_NAMES = [...TABLE_NAMES];

function quoted(names) {
  return names.map((n) => `"${n}"`).join(", ");
}

const ROLE_DDL = [
  // CREATEROLE privilege is assumed on the connection running this (the
  // same connection that already runs the rest of schema bootstrap, which
  // creates roles/permissions rows and functions - an equivalent level of
  // trust). NOLOGIN roles are not needed here: all three are meant to be
  // connected to directly via their own connection strings.
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vt_app') THEN
    CREATE ROLE vt_app LOGIN;
  END IF;
END $$`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vt_readonly_crosstenant') THEN
    CREATE ROLE vt_readonly_crosstenant LOGIN;
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
  // The two roles the app actually logs in as (role-credentials.js) are
  // pinned to the least privilege on every boot: an operator granting one
  // of them BYPASSRLS or CREATEROLE by hand would silently void isolation.
  "ALTER ROLE vt_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  "ALTER ROLE vt_readonly_crosstenant LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  // vt_admin is the bootstrap/migration/background-sweep identity - it
  // legitimately needs everything, including the control-plane tables, so
  // it alone keeps the blanket grant.
  "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vt_admin",
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vt_admin",
  "GRANT USAGE ON SCHEMA public TO vt_app, vt_readonly_crosstenant, vt_admin",
  `GRANT ALL PRIVILEGES ON TABLE ${quoted(VT_APP_TABLE_NAMES)} TO vt_app`,
  // Sequences don't hold tenant data (they only produce integers for serial/
  // identity columns), so there is no isolation reason to enumerate them
  // per table the way the table grants above are - vt_app keeps USAGE on
  // all of them.
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vt_app",
  // §3.1, §8: no write grant at all, at the database level - a future write
  // feature literally cannot become available to Owners inside a customer
  // tenant through this role, regardless of what application code does.
  // Explicitly excludes GLOBAL_TABLES and CONTROL_PLANE_TABLES: no reason to
  // expose reference data or platform bookkeeping through a cross-tenant
  // viewing role.
  `GRANT SELECT ON TABLE ${quoted(VT_READONLY_TABLE_NAMES)} TO vt_readonly_crosstenant`,
  // security_invoker views (see TENANT_SCOPED_VIEWS) - RLS on the tables
  // underneath applies to vt_app itself, so granting the view grants nothing
  // the tables don't already.
  `GRANT SELECT ON TABLE ${quoted(TENANT_SCOPED_VIEWS)} TO vt_app`,
];

// Exported for the grant-scope test: which tables actually end up in each
// role's GRANT statement, and which ones this migration deliberately keeps
// off vt_app/vt_readonly_crosstenant.
export const GRANT_DDL = ROLE_DDL;
export { VT_APP_TABLE_NAMES, VT_READONLY_TABLE_NAMES, CONTROL_PLANE_NAMES };

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

export const APP_LOGIN_ROLES = ["vt_app", "vt_readonly_crosstenant"];

/**
 * Sets each login role's password to the value client.js will derive, as a
 * SCRAM verifier - the plaintext is never sent to the server. A fresh salt
 * each boot is harmless: the password itself does not change, so live
 * connections and every other instance keep authenticating.
 */
export function rolePasswordDdl(superuserUrl = getEnv().postgres.url) {
  return APP_LOGIN_ROLES.flatMap((role) => {
    const password = deriveRolePassword(superuserUrl, role);
    return password ? [`ALTER ROLE ${role} PASSWORD '${scramVerifier(password)}'`] : [];
  });
}

export async function ensureTenancyRls() {
  if (!isTenancyRlsEnabled()) {
    return { ok: true, skipped: true, reason: "POSTGRES_TENANCY_RLS_ENABLED is not set" };
  }
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }
  // CREATE ROLE / GRANT / ALTER TABLE ... ENABLE ROW LEVEL SECURITY all need
  // elevated privileges regardless of what POSTGRES_URL becomes for
  // ordinary app requests - see ensure-lookup-schema.js's own comment.
  const pool = getAdminPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  const client = await pool.connect();
  try {
    for (const statement of [...ROLE_DDL, ...rolePasswordDdl(), ...RLS_POLICY_DDL]) {
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
