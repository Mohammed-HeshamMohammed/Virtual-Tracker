import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { isTenancyRlsEnabled } from "./ensure-tenancy-rls.js";
import { listTenantScopedTableNames } from "./tenancy-tables.js";

/**
 * Answers one question with evidence rather than assumption: is tenant
 * isolation actually load-bearing on this connection, right now?
 *
 * ensure-tenancy-rls.js creates the policies, but four separate things can
 * leave them inert - the feature flag is off, the DDL never ran, the policy
 * was dropped by hand, or the app connects as a role that bypasses RLS
 * (every superuser does, which is what a default hosted Postgres hands you).
 * In all four cases the queries still return rows and every test still
 * passes. Nothing is observably wrong until a second tenant exists, at which
 * point one organization can read another's data.
 *
 * So this does not trust the flag or the DDL's return value. It reads the
 * catalog for what is actually configured, then runs a live probe that tries
 * to see rows as a tenant that does not exist. A probe that returns rows is
 * proof isolation is not being applied, whatever the catalog claims.
 */

/**
 * Deliberately not a random UUID: a fixed, structurally valid v4 value that
 * tenants.id will never hold, so the probe is reproducible and a stray row
 * carrying it would be an obvious plant rather than a collision.
 */
export const PROBE_TENANT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * The probe reads this table because it is the one scoped table guaranteed
 * to be non-empty wherever the question matters - a database with no members
 * has no tenant data to leak, and an empty table would make the probe pass
 * for the wrong reason (see `inconclusive` below).
 */
const PROBE_TABLE = "members";

export const ISOLATION_ENFORCED = "enforced";
export const ISOLATION_NOT_ENFORCED = "not-enforced";
export const ISOLATION_UNKNOWN = "unknown";

/**
 * The pure core, kept separate from the queries so the decision table can be
 * tested without a database. Every input is what the catalog and the probe
 * reported; the output is the verdict and the reasons behind it.
 */
export function buildIsolationReport({
  rlsFlagEnabled,
  role = null,
  tables = [],
  probe = null,
  customerTenants = 0,
} = {}) {
  const reasons = [];
  const scoped = listTenantScopedTableNames();

  if (!rlsFlagEnabled) {
    reasons.push("POSTGRES_TENANCY_RLS_ENABLED is not set, so no policy was ever created.");
  }

  if (role?.bypassRls === true) {
    // rolsuper carries an implicit BYPASSRLS, so the caller folds the two
    // together; naming which one it was makes the fix obvious.
    const why = role.superuser ? "is a superuser" : "has the BYPASSRLS attribute";
    reasons.push(
      `The application connects as "${role.name}", which ${why} - Postgres skips every ` +
        "row-security policy for such a role, so the policies below are inert no matter how they are configured.",
    );
  }

  const withoutRls = tables.filter((t) => t.rowSecurity !== true).map((t) => t.name);
  const withoutForce = tables
    .filter((t) => t.rowSecurity === true && t.forceRowSecurity !== true)
    .map((t) => t.name);
  const withoutPolicy = tables.filter((t) => t.hasPolicy !== true).map((t) => t.name);
  const missing = scoped.filter((name) => !tables.some((t) => t.name === name));

  if (withoutRls.length) reasons.push(`Row security is not enabled on: ${summarize(withoutRls)}.`);
  // FORCE is what extends the policy to the table's own owner. Without it a
  // correct-looking policy still lets the owning role read everything, and
  // the owner is exactly who the app tends to connect as.
  if (withoutForce.length) reasons.push(`Row security is enabled but not FORCEd on: ${summarize(withoutForce)}.`);
  if (withoutPolicy.length) reasons.push(`No tenant_isolation policy on: ${summarize(withoutPolicy)}.`);
  if (missing.length) reasons.push(`Expected tables absent from the database: ${summarize(missing)}.`);

  if (probe?.ran === true && probe.inconclusive !== true && probe.visibleRows > 0) {
    reasons.push(
      `Live probe: reading ${PROBE_TABLE} while claiming to be a tenant that does not exist returned ` +
        `${probe.visibleRows} row(s). Under working isolation it must return 0.`,
    );
  }

  let status;
  if (reasons.length > 0) {
    status = ISOLATION_NOT_ENFORCED;
  } else if (probe?.ran === true && probe.inconclusive !== true && probe.visibleRows === 0) {
    // The only branch that reports success, and only a live probe earns it:
    // the catalog agreeing is necessary but has never been sufficient.
    status = ISOLATION_ENFORCED;
  } else {
    status = ISOLATION_UNKNOWN;
    reasons.push(
      probe?.inconclusive === true
        ? `The probe could not prove anything: ${PROBE_TABLE} is empty, so zero visible rows is not evidence.`
        : "The live probe did not run, so configuration is all that was checked.",
    );
  }

  // The whole point of the exercise. One tenant means nothing can leak
  // across tenants yet, so unenforced isolation is a known, bounded state.
  // A customer tenant turns exactly the same finding into live exposure.
  const critical = status !== ISOLATION_ENFORCED && customerTenants > 0;

  return {
    status,
    critical,
    customerTenants,
    reasons,
    checkedTables: tables.length,
    summary: describe(status, critical, customerTenants),
  };
}

function summarize(names, limit = 5) {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

function describe(status, critical, customerTenants) {
  if (status === ISOLATION_ENFORCED) return "Tenant isolation is enforced by the database.";
  if (critical) {
    return (
      `${customerTenants} customer tenant(s) exist and the database is NOT enforcing tenant isolation. ` +
      "Data from one organization is reachable from another."
    );
  }
  return (
    "Tenant isolation is not enforced by the database. No customer tenants exist, so nothing can " +
    "leak across tenants today, but a customer tenant must not be created until this is fixed."
  );
}

async function probeIsolation(client) {
  // A transaction that is always rolled back: SET LOCAL unwinds with it, so
  // a probe can never leave a bogus tenant published on a pooled connection.
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [PROBE_TENANT_ID]);
    const total = await client.query(`SELECT count(*)::int AS n FROM ${PROBE_TABLE}`);
    const visibleRows = total.rows[0]?.n ?? 0;
    return { ran: true, visibleRows, inconclusive: false };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function tableIsolationState(client, names) {
  const { rows } = await client.query(
    `SELECT c.relname                                   AS name,
            c.relrowsecurity                            AS row_security,
            c.relforcerowsecurity                       AS force_row_security,
            EXISTS (
              SELECT 1 FROM pg_policy p
              WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
            )                                           AS has_policy
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)`,
    [names],
  );
  return rows.map((r) => ({
    name: r.name,
    rowSecurity: r.row_security === true,
    forceRowSecurity: r.force_row_security === true,
    hasPolicy: r.has_policy === true,
  }));
}

async function connectedRole(client) {
  const { rows } = await client.query(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.rolname,
    superuser: row.rolsuper === true,
    // A superuser bypasses RLS without the attribute being set, so the two
    // are folded together here: what matters downstream is only whether
    // policies apply to this connection at all.
    bypassRls: row.rolsuper === true || row.rolbypassrls === true,
  };
}

/** Runs every check and returns the report. Never throws: a verifier that
 *  takes the server down when it cannot reach the catalog is worse than one
 *  that reports what it could not determine. */
export async function verifyTenancyIsolation() {
  if (!isPostgresConfigured()) {
    return { ...buildIsolationReport({ rlsFlagEnabled: isTenancyRlsEnabled() }), skipped: true };
  }
  const pool = getPostgresPool();
  if (!pool) {
    return { ...buildIsolationReport({ rlsFlagEnabled: isTenancyRlsEnabled() }), skipped: true };
  }

  const client = await pool.connect();
  try {
    const scoped = listTenantScopedTableNames();
    const [role, tables] = await Promise.all([connectedRole(client), tableIsolationState(client, scoped)]);

    const counts = await client.query(
      "SELECT count(*)::int AS n FROM tenants WHERE type = 'customer' AND lifecycle <> 'removed'",
    );
    const customerTenants = counts.rows[0]?.n ?? 0;

    let probe = null;
    try {
      probe = await probeIsolation(client);
      if (probe.visibleRows === 0) {
        // Zero rows means nothing if the table is empty for everyone. Ask
        // again with no tenant filter in play to tell the two cases apart.
        const all = await client.query(`SELECT count(*)::int AS n FROM ${PROBE_TABLE}`);
        if ((all.rows[0]?.n ?? 0) === 0) probe = { ...probe, inconclusive: true };
      }
    } catch (err) {
      logSafeWarn("[postgres] tenant isolation probe failed:", err);
      probe = { ran: false };
    }

    return buildIsolationReport({
      rlsFlagEnabled: isTenancyRlsEnabled(),
      role,
      tables,
      probe,
      customerTenants,
    });
  } catch (err) {
    logSafeWarn("[postgres] tenant isolation verification failed:", err);
    return {
      status: ISOLATION_UNKNOWN,
      critical: false,
      customerTenants: 0,
      reasons: ["The verification queries themselves failed; isolation state is unknown."],
      checkedTables: 0,
      summary: "Tenant isolation could not be verified.",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.release();
  }
}

/**
 * Cached because the tenant-creation guard calls it on a user action, and
 * the answer only changes when someone runs a migration or edits a
 * connection string - neither of which happens between two requests.
 */
let cached = null;

export async function getTenancyIsolationReport({ refresh = false } = {}) {
  if (refresh || !cached) cached = await verifyTenancyIsolation();
  return cached;
}

export function __resetTenancyIsolationCacheForTests() {
  cached = null;
}
