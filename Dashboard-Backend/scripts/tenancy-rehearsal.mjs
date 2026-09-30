// Stage D of the tenancy cutover: rehearse enforcement on a disposable COPY of
// the production database, from inside the backend container, before it is
// ever switched on for real.
//
//   node scripts/tenancy-rehearsal.mjs vt_rehearsal
//
// It targets only the named copy (never the database POSTGRES_URL points at),
// builds that URL from the container's own POSTGRES_URL - so no credential is
// ever typed - and never runs sweeps, removal, or anything touching GCS (the
// copy's screenshot rows point at real blobs).
//
// What it proves, against the real Postgres server:
//   1. The boot migrations (schema, tenancy, RLS) apply to a production-shaped DB.
//   2. vt_app logs in over TCP with its derived SCRAM password, is itself the
//      session user, and cannot SET ROLE back to the superuser.
//   3. Differential check on EVERY tenant-scoped table and view: with only the
//      main tenant present, vt_app (main published) sees exactly what the
//      superuser sees. Any difference is a grant/policy/view bug.
//   4. A synthetic second tenant is invisible to main and vice versa; a
//      cross-tenant insert is rejected.
//   5. Two concurrent invites for the last seat: exactly one wins.
//   6. The isolation probe that gates customer creation reports enforced.
import pg from "pg";

const target = process.argv[2];
if (target !== "vt_rehearsal") {
  console.error("Refusing: pass the rehearsal database name explicitly (vt_rehearsal).");
  process.exit(2);
}
const productionUrl = process.env.POSTGRES_URL;
if (!productionUrl) {
  console.error("POSTGRES_URL is not set in this environment.");
  process.exit(2);
}
const rehearsal = new URL(productionUrl);
const productionDb = rehearsal.pathname.replace(/^\//, "");
if (productionDb === target) {
  console.error("Refusing: the rehearsal target is the production database.");
  process.exit(2);
}
rehearsal.pathname = `/${target}`;
const rehearsalUrl = rehearsal.toString();

// Everything below runs against the copy only. Set before any app module
// loads, since env.js caches on first read.
process.env.POSTGRES_URL = rehearsalUrl;
delete process.env.POSTGRES_ADMIN_URL;
delete process.env.POSTGRES_APP_URL;
delete process.env.POSTGRES_READONLY_CROSSTENANT_URL;
process.env.POSTGRES_TENANCY_RLS_ENABLED = "true";
process.env.POSTGRES_TENANCY_ENFORCE = "false";
process.env.GCS_BUCKET_NAME = "";

const { ensurePostgresLookupSchema } = await import("../src/lib/postgres/ensure-lookup-schema.js");
const { ensureTenancySchema, MAIN_TENANT_ID } = await import("../src/lib/postgres/ensure-tenancy-schema.js");
const { ensureTenancyRls } = await import("../src/lib/postgres/ensure-tenancy-rls.js");
const { roleConnectionString } = await import("../src/lib/postgres/role-credentials.js");
const { TENANT_SCOPED_TABLES, TENANT_SCOPED_VIEWS } = await import("../src/lib/postgres/tenancy-tables.js");
const { SEAT_LOCK_SQL, usedSeatsSql } = await import("../src/modules/customer-accounts/seat-usage.service.js");
const { __closePostgresPoolForTests } = await import("../src/lib/postgres/client.js");

const admin = new pg.Pool({ connectionString: rehearsalUrl, max: 2 });
const app = new pg.Pool({ connectionString: roleConnectionString(rehearsalUrl, "vt_app"), max: 3 });

let failures = 0;
async function step(name, fn) {
  try {
    const note = await fn();
    console.log(`ok   - ${name}${note ? ` (${note})` : ""}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL - ${name}\n       ${err instanceof Error ? err.message : err}`);
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message);
}
async function asTenant(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const TENANT_B = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const tableNames = TENANT_SCOPED_TABLES.map((e) => (typeof e === "string" ? e : e.name));

await step("boot migrations apply to the copy", async () => {
  for (const [name, fn] of [
    ["lookup schema", ensurePostgresLookupSchema],
    ["tenancy schema", ensureTenancySchema],
    ["RLS", ensureTenancyRls],
  ]) {
    const r = await fn();
    expect(r.ok !== false, `${name}: ${r.error}`);
    expect(r.skipped !== true, `${name} was skipped`);
  }
});

// The synthetic tenant is left behind by an earlier run (a failed or repeated
// rehearsal), and the differential below must see only the main tenant.
await step("leftovers from an earlier rehearsal are cleared", async () => {
  const c = await admin.connect();
  try {
    await c.query("SET session_replication_role = replica");
    let cleared = 0;
    for (const t of tableNames) {
      cleared += (await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_B])).rowCount ?? 0;
    }
    await c.query("DELETE FROM tenants WHERE id = $1", [TENANT_B]);
    return `${cleared} rows`;
  } finally {
    await c.query("SET session_replication_role = DEFAULT").catch(() => {});
    c.release();
  }
});

await step("vt_app logs in with its derived password and cannot escalate", async () => {
  const c = await app.connect();
  try {
    const who = (await c.query("SELECT current_user AS cu, session_user AS su")).rows[0];
    expect(who.cu === "vt_app" && who.su === "vt_app", `connected as ${who.cu}/${who.su}`);
    let escalated = false;
    try {
      await c.query("SET ROLE postgres");
      escalated = true;
    } catch {
      /* expected */
    }
    expect(!escalated, "vt_app was able to SET ROLE postgres");
  } finally {
    c.release();
  }
});

await step("differential: vt_app (main) sees exactly what the superuser sees, table by table", async () => {
  const foreign = [];
  const diffs = [];
  for (const t of [...tableNames, ...TENANT_SCOPED_VIEWS]) {
    const all = Number((await admin.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    if (tableNames.includes(t)) {
      const other = Number(
        (await admin.query(`SELECT count(*) AS n FROM ${t} WHERE tenant_id IS DISTINCT FROM $1`, [MAIN_TENANT_ID])).rows[0].n,
      );
      if (other) foreign.push(`${t}:${other}`);
    }
    const seen = await asTenant(app, MAIN_TENANT_ID, async (c) => Number((await c.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n));
    if (seen !== all) diffs.push(`${t}: superuser ${all}, vt_app ${seen}`);
  }
  expect(!foreign.length, `rows outside the main tenant before the test: ${foreign.join(", ")}`);
  expect(!diffs.length, diffs.join("; "));
  return `${tableNames.length} tables + ${TENANT_SCOPED_VIEWS.length} views identical`;
});

await step("a second tenant is invisible across the boundary, both ways", async () => {
  await admin.query(
    `INSERT INTO tenants (id, type, granted_role, seat_limit, period_start, period_end, lifecycle)
     VALUES ($1, 'customer', 'Enterprise Manager', 2, now(), now() + interval '30 days', 'live')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  await admin.query(`INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'Rehearsal B project', 'active')`, [TENANT_B]);
  const mainSeesB = await asTenant(app, MAIN_TENANT_ID, async (c) =>
    Number((await c.query(`SELECT count(*) AS n FROM projects WHERE name = 'Rehearsal B project'`)).rows[0].n),
  );
  expect(mainSeesB === 0, "main tenant can see tenant B's project");
  const bSees = await asTenant(app, TENANT_B, async (c) => (await c.query(`SELECT DISTINCT tenant_id FROM projects`)).rows);
  expect(bSees.length === 1 && bSees[0].tenant_id === TENANT_B, "tenant B sees rows outside itself");
  let crossWrite = false;
  try {
    await asTenant(app, MAIN_TENANT_ID, (c) =>
      c.query(`INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'x', 'active')`, [TENANT_B]),
    );
    crossWrite = true;
  } catch {
    /* expected */
  }
  expect(!crossWrite, "a main-scoped connection wrote into tenant B");
});

await step("two concurrent invites for the last seat: exactly one wins", async () => {
  const used = usedSeatsSql("$1");
  const attempt = (label) =>
    asTenant(app, TENANT_B, async (c) => {
      await c.query(SEAT_LOCK_SQL, [TENANT_B]);
      const limit = Number((await c.query("SELECT tenant_seat_limit($1) AS n", [TENANT_B])).rows[0].n);
      const inUse = Number((await c.query(`SELECT ${used} AS n`, [TENANT_B])).rows[0].n);
      await new Promise((r) => setTimeout(r, 200));
      if (inUse + 1 > limit) throw new Error("seat limit reached");
      await c.query(
        `INSERT INTO invites (id, email, invite_token, invite_kind, status, tenant_id)
         VALUES (gen_random_uuid(), $1, $2, 'email', 'pending_signup', $3)`,
        [`${label}@rehearsal.test`, `rehearsal-${label}-${Date.now()}`, TENANT_B],
      );
      return label;
    });
  // Leave exactly one open seat, then race for it.
  await admin.query(`UPDATE tenants SET seat_limit = (SELECT ${usedSeatsSql("$1")}) + 1 WHERE id = $1`, [TENANT_B]);
  const results = await Promise.allSettled([attempt("first"), attempt("second")]);
  const won = results.filter((r) => r.status === "fulfilled").length;
  expect(won === 1, `${won} of 2 concurrent invites succeeded`);
});

await step("the isolation probe that gates customer creation reports enforced", async () => {
  const c = await app.connect();
  try {
    const role = (await c.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
    expect(!role.rolsuper && !role.rolbypassrls, "vt_app bypasses RLS");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true)");
    const probe = Number((await c.query("SELECT count(*) AS n FROM members")).rows[0].n);
    await c.query("ROLLBACK");
    const total = Number((await admin.query("SELECT count(*) AS n FROM members")).rows[0].n);
    expect(total > 0, "members is empty - probe would be inconclusive");
    expect(probe === 0, `probe saw ${probe} rows as a nonexistent tenant`);
  } finally {
    c.release();
  }
});

await Promise.all([admin.end(), app.end(), __closePostgresPoolForTests()]);
console.log(failures === 0 ? "\nREHEARSAL: PASS" : `\nREHEARSAL: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
