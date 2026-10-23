// An in-memory Postgres (PGlite) carrying the app's real schema, for tests that run the actual
// query functions and route handlers and check the rows they return or leave behind, instead of
// the SQL text they send.
//
// The schema is built by the same boot code production runs (ensurePostgresLookupSchema and
// ensureTenancySchema), so a renamed column or a dropped constraint breaks these tests the way it
// would break the app. lib/postgres/client.js is mocked onto the database; import the modules
// under test only after `startPglite()` resolves, so they pick up the mock.
//
// With `rls: true` the real ensureTenancyRls also runs, and the client behaves like production
// with tenancy enforced: query()/withTransaction() run as vt_app with the request's tenant
// published (so row-level security filters them), queryAsAdmin() runs as the owner. Roles are
// switched with SET ROLE on the one embedded connection, as test-live/tenancy-rls-live does.
//
// Needs --experimental-test-module-mocks (the package's `npm test` passes it).
import { mock } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
export const srcUrl = (rel) => pathToFileURL(`${SRC}/${rel}`).href;

export async function loadPglite() {
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    return { PGlite, pgcrypto };
  } catch {
    return null;
  }
}

/**
 * Starts the database, mocks the Postgres client onto it and applies the boot schema.
 * `mocks` maps a src-relative path to namedExports, for collaborators the test wants to replace.
 * Returns null when PGlite is not installed, so a file can skip itself.
 */
export async function startPglite({ mocks = {}, rls = false } = {}) {
  const lib = await loadPglite();
  if (!lib) return null;
  // Values come back the way node-postgres (what production uses) returns them where PGlite
  // differs: 'infinity' timestamps as Infinity, int8 as a string.
  const { default: pgDriver } = await import("pg");
  const like = (oid) => [oid, pgDriver.types.getTypeParser(oid)];
  const parsers = Object.fromEntries([1184, 1114, 20].map(like));
  const db = new lib.PGlite({ extensions: { pgcrypto: lib.pgcrypto }, parsers });
  await db.exec("SET TIME ZONE 'UTC'");

  if (rls) {
    // ensureTenancyRls only runs when the flag is on, and derives the login roles' passwords
    // from the superuser URL.
    process.env.POSTGRES_URL = "postgres://postgres:pglite-harness@localhost:5432/postgres";
    process.env.POSTGRES_TENANCY_RLS_ENABLED = "true";
    const { __resetEnvForTests } = await import(srcUrl("config/env.js"));
    __resetEnvForTests();
  }
  const { currentTenantId } = await import(srcUrl("lib/postgres/audit-actor.js"));

  // One embedded connection stands in for the pool, so each logical connection (a query, or a
  // whole transaction) holds it until done - otherwise two awaits could interleave statements
  // inside one BEGIN. Work started while holding it (a query() inside a transaction callback)
  // runs on the held connection instead of waiting for itself.
  const holding = new AsyncLocalStorage();
  let tail = Promise.resolve();
  const exclusive = (fn) => {
    if (holding.getStore()) return fn();
    const run = tail.then(() => holding.run(true, fn));
    tail = run.catch(() => {});
    return run;
  };

  let rlsOn = false;
  // Runs `fn` as the given identity: "admin" is the table owner, "app" is vt_app scoped to `tenant`.
  const as = async (identity, tenant, fn) => {
    if (!rlsOn || identity === "admin") return fn();
    await db.query(`SET ROLE ${identity === "readonly" ? "vt_readonly_crosstenant" : "vt_app"}`);
    await db.query("SELECT set_config('app.tenant_id', $1, false)", [tenant ?? ""]);
    try {
      return await fn();
    } finally {
      await db.query("RESET ROLE");
    }
  };
  const raw = (identity, tenant) => (sql, params) => exclusive(() => as(identity, tenant, () => db.query(sql, params)));
  const rowsOf = (identity) => async (sql, params) => (await raw(identity, currentTenantId())(sql, params)).rows;
  const wrap = (result) => ({ ...result, rowCount: result.affectedRows ?? result.rows.length });
  const tx = (identity) => (fn) =>
    exclusive(async () => {
      await db.query("BEGIN");
      try {
        if (rlsOn && identity === "app") {
          await db.query("SET LOCAL ROLE vt_app");
          await db.query("SELECT set_config('app.tenant_id', $1, true)", [currentTenantId() ?? ""]);
        }
        const out = await fn({ query: async (sql, params) => wrap(await db.query(sql, params)) });
        await db.query("COMMIT");
        return out;
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    });
  const pool = (identity) => ({
    connect: async () => ({ query: async (sql, params) => wrap(await raw(identity, currentTenantId())(sql, params)), release: () => {} }),
    query: async (sql, params) => wrap(await raw(identity, currentTenantId())(sql, params)),
  });

  mock.module(srcUrl("lib/postgres/client.js"), {
    namedExports: {
      query: rowsOf("app"),
      queryAsAdmin: rowsOf("admin"),
      queryAsReadonlyCrossTenant: async (tenant, sql, params) => (await raw("readonly", tenant)(sql, params)).rows,
      queryRaw: async (sql, params) => wrap(await raw("app", currentTenantId())(sql, params)),
      withTransaction: tx("app"),
      withTransactionAsAdmin: tx("admin"),
      withTenant: async (tenant, fn) => (await import(srcUrl("lib/postgres/audit-actor.js"))).runWithTenantId(tenant, fn),
      isPostgresConfigured: () => true,
      isTenancyEnforced: () => rls,
      getPostgresPool: () => pool("app"),
      getAdminPostgresPool: () => pool("admin"),
      getReadonlyCrossTenantPostgresPool: () => pool("readonly"),
      probePostgresReadiness: async () => true,
      __closePostgresPoolForTests: async () => {},
    },
  });
  for (const [rel, namedExports] of Object.entries(mocks)) {
    mock.module(srcUrl(rel), { namedExports });
  }

  const { ensurePostgresLookupSchema } = await import(srcUrl("lib/postgres/ensure-lookup-schema.js"));
  const { ensureTenancySchema } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));
  const lookup = await ensurePostgresLookupSchema();
  if (!lookup.ok) throw new Error(`boot schema failed: ${lookup.error}`);
  const tenancy = await ensureTenancySchema();
  if (!tenancy.ok) throw new Error(`tenancy schema failed: ${tenancy.error}`);
  // The app's default roles, then a second boot: the boot DDL sets each role's hierarchy level
  // and management flag, which only takes once the roles exist - as on any restarted server.
  const { ensureDefaultRoles } = await import(srcUrl("modules/members/services/relation-sync.js"));
  await ensureDefaultRoles(null);
  const again = await ensurePostgresLookupSchema();
  if (!again.ok) throw new Error(`second boot failed: ${again.error}`);
  if (rls) {
    const { ensureTenancyRls } = await import(srcUrl("lib/postgres/ensure-tenancy-rls.js"));
    const applied = await ensureTenancyRls();
    if (!applied.ok || applied.skipped) throw new Error(`tenancy RLS not applied: ${applied.error ?? applied.reason}`);
    rlsOn = true;
  }

  // Test-side access is always the owner's, so seeding and checking see every tenant.
  const adminRows = rowsOf("admin");
  return { db, rows: adminRows, close: () => db.close() };
}

/**
 * Row writers over the real schema: `insert("members", { first_name: "Ada" })` returns the row
 * as stored (defaults filled in). `member("Client", {...})` creates a member holding that role.
 */
export function seeder(pg) {
  const insert = async (table, row = {}) => {
    const keys = Object.keys(row);
    const sql = keys.length
      ? `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`
      : `INSERT INTO ${table} DEFAULT VALUES RETURNING *`;
    return (await pg.rows(sql, keys.map((k) => row[k])))[0];
  };
  const roleIds = new Map();
  const role = async (name) => {
    if (!roleIds.has(name)) {
      const found = await pg.rows("SELECT id FROM roles WHERE name = $1", [name]);
      roleIds.set(name, found[0]?.id ?? (await insert("roles", { name })).id);
    }
    return roleIds.get(name);
  };
  const member = async (roleName = "Employee", row = {}) =>
    insert("members", { first_name: roleName, status: "active", role_id: await role(roleName), ...row });
  return { insert, role, member };
}

/**
 * Calls a route handler the way the server does: inside a request scope (so the viewer's member
 * and tenant reach the database), signed in as `viewer` when given, with an optional JSON body.
 * `invoke(req, res, url)` calls the handler with whatever extra arguments it takes.
 */
export async function request({ method = "GET", path, viewer = null, body, headers = {} }, invoke) {
  const { Readable } = await import("node:stream");
  const { setAuthContext } = await import(srcUrl("http/auth-context.js"));
  const { runWithAuditActor } = await import(srcUrl("lib/postgres/audit-actor.js"));
  const res = fakeResponse();
  const handled = await runWithAuditActor(async () => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = path;
    req.headers = { authorization: "Bearer test-token", "content-type": "application/json", ...headers };
    req.socket = { remoteAddress: "127.0.0.1" };
    if (viewer) setAuthContext(req, viewer);
    return invoke(req, res, new URL(`http://localhost${path}`));
  });
  res.handled = handled;
  return res;
}

/** Captures what sendJson (or a file download) wrote. */
export function fakeResponse() {
  const chunks = [];
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader(k) { return res.headers[k.toLowerCase()]; },
    writeHead(status, headers) {
      res.statusCode = status;
      for (const [k, v] of Object.entries(headers ?? {})) res.headers[k.toLowerCase()] = v;
      return res;
    },
    write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
    end(body) {
      if (body !== undefined && body !== null) chunks.push(Buffer.from(body));
      res.buffer = Buffer.concat(chunks);
      try { res.body = res.buffer.length ? JSON.parse(res.buffer.toString("utf8")) : null; } catch { res.body = null; }
      if (res.statusCode === null) res.statusCode = 200;
    },
  };
  return res;
}
