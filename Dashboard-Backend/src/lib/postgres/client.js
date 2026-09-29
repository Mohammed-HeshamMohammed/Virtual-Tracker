import pg from "pg";
import { getEnv } from "../../config/env.js";
import { currentAuditActor, currentTenantId, runWithTenantId, statementMayAudit } from "./audit-actor.js";
import { roleConnectionString } from "./role-credentials.js";
import { auditTenantlessQuery } from "./tenancy-audit.js";

/**
 * Keyed by resolved connection-string URL, not by role name: identities that
 * resolve to the same URL (every one of them, until POSTGRES_TENANCY_ENFORCE
 * is on) share one physical pg.Pool, and each gets its own the moment its
 * URL genuinely differs.
 */
const poolsByUrl = new Map();

function getOrCreatePool(url) {
  if (!url) return null;
  let p = poolsByUrl.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url });
    p.on("connect", (client) => {
      client.query("SET TIME ZONE 'UTC'").catch(() => {});
    });
    poolsByUrl.set(url, p);
  }
  return p;
}

let warnedEnforceWithoutRls = false;

/**
 * Whether the app connects as the restricted roles. Requires
 * POSTGRES_TENANCY_RLS_ENABLED too: that flag is what creates the roles and
 * sets their passwords at boot, so enforcing without it would only produce
 * a pool that cannot log in.
 */
export function isTenancyEnforced() {
  const pgEnv = getEnv().postgres;
  if (pgEnv.tenancyEnforce !== true) return false;
  if (pgEnv.tenancyRlsEnabled !== true) {
    if (!warnedEnforceWithoutRls) {
      warnedEnforceWithoutRls = true;
      console.warn("[postgres] POSTGRES_TENANCY_ENFORCE is ignored: POSTGRES_TENANCY_RLS_ENABLED is not on.");
    }
    return false;
  }
  return true;
}

/**
 * Ordinary request traffic. Once enforced, logs in as vt_app - a real
 * LOGIN role whose RLS policies apply and which cannot SET ROLE back to the
 * superuser. Fails closed: if the credential cannot be derived there is no
 * pool, rather than a silent fallback to the superuser connection.
 */
export function getPostgresPool() {
  const pgEnv = getEnv().postgres;
  if (!isTenancyEnforced()) return getOrCreatePool(pgEnv.url);
  return getOrCreatePool(pgEnv.appUrl || roleConnectionString(pgEnv.url, "vt_app"));
}

/**
 * Bootstrap/migration/background-sweep identity. The superuser POSTGRES_URL
 * unless POSTGRES_ADMIN_URL overrides it - it has to own the tables to run
 * the schema migrations, and bypass RLS to enumerate every tenant.
 */
export function getAdminPostgresPool() {
  return getOrCreatePool(getEnv().postgres.adminUrl);
}

/**
 * Audited cross-tenant read-only identity - SELECT-only at the grant level
 * (ensure-tenancy-rls.js), never write-capable regardless of what
 * application code does.
 */
export function getReadonlyCrossTenantPostgresPool() {
  const pgEnv = getEnv().postgres;
  if (pgEnv.readonlyCrossTenantUrl) return getOrCreatePool(pgEnv.readonlyCrossTenantUrl);
  if (!isTenancyEnforced()) return getOrCreatePool(pgEnv.url);
  return getOrCreatePool(roleConnectionString(pgEnv.url, "vt_readonly_crosstenant"));
}

export function isPostgresConfigured() {
  const url = getEnv().postgres.url;
  return Boolean(url);
}

/**
 * The actor/tenant currently published on a pooled connection, so the extra
 * round-trip is paid once per connection rather than once per query.
 */
const PUBLISHED_ACTOR = Symbol("vtPublishedAuditActor");
const PUBLISHED_TENANT = Symbol("vtPublishedTenantId");

/**
 * Publishes the request's actor on this connection so the audit trigger can
 * record who made the change (see audit-actor.js).
 *
 * Connections are pooled, so a write with no actor has to clear whatever the
 * previous borrower left behind rather than inheriting it - which is why this
 * publishes '' rather than skipping when there is nobody to attribute. Caching
 * what was last published keeps that from costing a round-trip on every insert
 * the agent ingest makes: those all run with the same (empty) actor, so after
 * the first one on a given connection there is nothing to change.
 */
async function publishAuditActor(client, sql) {
  if (!statementMayAudit(sql)) return;
  const actor = currentAuditActor() ?? "";
  if (client[PUBLISHED_ACTOR] === actor) return;
  await client.query("SELECT set_config('app.actor_id', $1, false)", [actor]);
  client[PUBLISHED_ACTOR] = actor;
}

/**
 * Publishes the request's tenant on this connection so the RLS policy on
 * every scoped table can read it back (PLAN-customer-accounts-and-
 * tenancy.md §3.2). Unlike the actor above, this runs on EVERY statement,
 * reads included - a SELECT is exactly what RLS's USING clause has to
 * filter, so gating this behind statementMayAudit's write-only heuristic
 * (correct for the audit trigger, which only fires on writes) would leave a
 * pooled connection answering reads under whichever tenant the PREVIOUS
 * borrower last published. An empty tenant publishes '' (NULLIF turns that
 * into NULL in the policy, which matches nothing - see ensure-tenancy-
 * rls.js) rather than being skipped, for the same pooling reason
 * publishAuditActor always writes something rather than only clearing.
 */
async function publishTenantId(client) {
  const tenant = currentTenantId() ?? "";
  if (client[PUBLISHED_TENANT] === tenant) return;
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenant]);
  client[PUBLISHED_TENANT] = tenant;
}

async function queryOnPool(activePool, sql, params) {
  if (!activePool) {
    throw new Error("Postgres pool is not configured");
  }
  const client = await activePool.connect();
  try {
    await publishTenantId(client);
    await publishAuditActor(client, sql);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function query(sql, params = []) {
  auditTenantlessQuery(sql);
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  return queryOnPool(activePool, sql, params);
}

/**
 * Same as query(), on the vt_admin identity (bootstrap/migrations/
 * background sweeps - BYPASSRLS once RLS is live). Falls back to the same
 * pool as query() until POSTGRES_ADMIN_URL is configured separately.
 */
export async function queryAsAdmin(sql, params = []) {
  const activePool = getAdminPostgresPool();
  if (!activePool) {
    throw new Error("Postgres is not configured");
  }
  return queryOnPool(activePool, sql, params);
}

/**
 * Audited read-only access to another tenant's data (§0.2 step 5 - Owner
 * viewing a customer tenant's business data). Explicitly publishes
 * targetTenantId rather than the caller's own currentTenantId(), since the
 * whole point is reading a DIFFERENT tenant than the viewer's own; write
 * statements are rejected at the grant level by vt_readonly_crosstenant
 * regardless of what this function does.
 */
export async function queryAsReadonlyCrossTenant(targetTenantId, sql, params = []) {
  const activePool = getReadonlyCrossTenantPostgresPool();
  if (!activePool) {
    throw new Error("Postgres is not configured");
  }
  const client = await activePool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [targetTenantId ?? ""]);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Same as query() (tenant + actor published, same pooling), but returns the
 * raw pg result ({rows, rowCount}) instead of unwrapping to just the rows -
 * for the handful of callers that need rowCount and previously reached past
 * this file with their own local pool.connect() helper to get it. Doing
 * that meant those call sites got neither tenant nor actor publishing -
 * harmless for actor (their writes just went unattributed in audit_logs),
 * but a real tenant-isolation gap once RLS is live (§12.2 #5: "any code
 * path that gets a raw pool.connect() outside client.js must publish the
 * tenant itself" - this is that fix, applied here instead of duplicating
 * the publish/cache logic in each of those files).
 */
export async function queryRaw(sql, params = []) {
  auditTenantlessQuery(sql);
  const activePool = getPostgresPool();
  if (!activePool) return null;
  const client = await activePool.connect();
  try {
    await publishTenantId(client);
    await publishAuditActor(client, sql);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function withTransactionOnPool(activePool, fn, { audit = false } = {}) {
  if (!activePool) {
    throw new Error("Postgres pool is not configured");
  }
  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    // Once per transaction: SET LOCAL is scoped to it and unwinds on COMMIT or
    // ROLLBACK, so nothing leaks back into the pool.
    await client.query("SELECT set_config('app.actor_id', $1, true)", [currentAuditActor() ?? ""]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [currentTenantId() ?? ""]);
    // ...which also means whatever `query()` cached about this connection is
    // no longer true once the transaction ends.
    delete client[PUBLISHED_ACTOR];
    delete client[PUBLISHED_TENANT];
    const result = await fn(audit ? auditingClient(client) : client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The transaction's own client, with each statement run past the tenancy
 *  audit first - the app pool only; the admin pool is exempt by design. */
function auditingClient(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (sql, ...rest) => {
          auditTenantlessQuery(typeof sql === "string" ? sql : sql?.text);
          return target.query(sql, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function withTransaction(fn) {
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  return withTransactionOnPool(activePool, fn, { audit: getEnv().postgres?.tenancyAudit === true });
}

/** Same as withTransaction(), on the vt_admin identity. */
export async function withTransactionAsAdmin(fn) {
  const activePool = getAdminPostgresPool();
  if (!activePool) {
    throw new Error("Postgres is not configured");
  }
  return withTransactionOnPool(activePool, fn);
}

/**
 * §15.2: the background-sweep equivalent of a request handler. A sweep
 * loops over every tenant's due work with no HTTP request to carry a tenant
 * through auth-context.js, so it opens its own scope here instead -
 * everything `fn` does (including further withTransaction calls) runs
 * against exactly that one tenant.
 *
 * This is also the fix for every "background sweep bypasses RLS and could
 * silently aggregate across tenants" risk noted in the plan (§12.2 #6):
 * calling this per tenant forces the sweep to say which tenant it is
 * working on, rather than running one query across all of them.
 */
export async function withTenant(tenantId, fn) {
  return runWithTenantId(tenantId, fn);
}

export async function probePostgresReadiness() {
  if (!isPostgresConfigured()) return true;
  try {
    await query("SELECT 1 AS ok");
    return true;
  } catch {
    return false;
  }
}

export async function __closePostgresPoolForTests() {
  const pools = [...poolsByUrl.values()];
  poolsByUrl.clear();
  await Promise.all(pools.map((p) => p.end()));
}
