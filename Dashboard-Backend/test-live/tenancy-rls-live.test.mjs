// PLAN-customer-accounts-and-tenancy.md §0.2 step 7: "In CI, create two
// tenants with colliding human names/numbers, connect as each database
// role, exercise every public bootstrap route and every CRUD module, prove
// cross-tenant reads/writes fail." This is the first concrete piece of
// that - not the whole CRUD surface, but the foundational proof the rest
// depends on: the REAL boot-time schema (ensurePostgresLookupSchema,
// ensureTenancySchema, ensureTenancyRls - not a reimplementation) applied
// to a real Postgres engine, with two tenants and each of the three roles
// actually connected as (via SET ROLE, since PGlite is one embedded
// connection rather than separate authenticated TCP connections - SET ROLE
// changes the privilege-checking identity the same way a real separate
// connection as that role would, which is what RLS and GRANT both key off).
//
// Deliberately NOT part of `npm test` (test/*.test.js, always-mocked-DB) -
// this is a separate, slower, CI-only tier. Run with:
//   npm run test:tenancy-live
import assert from "node:assert/strict";
import { mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
// Only its password matters here: role-credentials.js derives the vt_app /
// vt_readonly_crosstenant passwords from it.
const SUPERUSER_URL = "postgres://postgres:harness-superuser-secret@localhost:5432/postgres";

function wrapResult(result) {
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
}

function makePoolLike() {
  return {
    connect: async () => ({
      query: async (sql, params) => wrapResult(await db.query(sql, params)),
      release: () => {},
    }),
    query: async (sql, params) => wrapResult(await db.query(sql, params)),
  };
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    isPostgresConfigured: () => true,
    getPostgresPool: () => makePoolLike(),
    // Same underlying PGlite instance/connection as the ordinary pool - this
    // harness proves role separation via SET ROLE (see asRole below), not
    // via genuinely separate connections, so both identities point at the
    // one embedded engine.
    getAdminPostgresPool: () => makePoolLike(),
    query: async (sql, params) => (await db.query(sql, params)).rows,
    queryAsAdmin: async (sql, params) => (await db.query(sql, params)).rows,
    queryRaw: async (sql, params) => wrapResult(await db.query(sql, params)),
    withTransaction: async (fn) =>
      fn({ query: async (sql, params) => wrapResult(await db.query(sql, params)) }),
  },
});

mock.module("../src/config/env.js", {
  namedExports: {
    getEnv: () => ({
      postgres: { tenancyRlsEnabled: true, url: SUPERUSER_URL, adminUrl: SUPERUSER_URL },
      activity: {
        captureMode: "web",
        webCaptureEnabled: false,
        taskScreenshotsEnabled: false,
        desktopAgentIngestEnabled: false,
      },
    }),
  },
});

const { ensurePostgresLookupSchema } = await import("../src/lib/postgres/ensure-lookup-schema.js");
const { ensureTenancySchema } = await import("../src/lib/postgres/ensure-tenancy-schema.js");
const { ensureTenancyRls } = await import("../src/lib/postgres/ensure-tenancy-rls.js");

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`NOT OK - ${name}\n  ${err.stack || err}`);
  }
}

async function asRole(role, tenantId, fn) {
  await db.query(`SET ROLE ${role}`);
  if (tenantId !== undefined) {
    await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? ""]);
  }
  try {
    return await fn();
  } finally {
    await db.query(`RESET ROLE`);
  }
}

console.log("--- applying real boot-time schema to PGlite ---");
const schemaResult = await ensurePostgresLookupSchema();
if (schemaResult.ok === false) throw new Error(`ensurePostgresLookupSchema failed: ${schemaResult.error}`);
const tenancyResult = await ensureTenancySchema();
if (tenancyResult.ok === false) throw new Error(`ensureTenancySchema failed: ${tenancyResult.error}`);
const rlsResult = await ensureTenancyRls();
if (rlsResult.ok === false) throw new Error(`ensureTenancyRls failed: ${rlsResult.error}`);
console.log("schema + RLS applied successfully.\n");

console.log("--- seeding two tenants with colliding project names ---");
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
await db.query(
  `INSERT INTO tenants (id, type, granted_role, seat_limit, period_start, period_end, lifecycle)
   VALUES ($1, 'customer', 'Enterprise Manager', 10, now(), now() + interval '30 days', 'live')`,
  [TENANT_A],
);
await db.query(
  `INSERT INTO tenants (id, type, granted_role, seat_limit, period_start, period_end, lifecycle)
   VALUES ($1, 'customer', 'Enterprise Manager', 10, now(), now() + interval '30 days', 'live')`,
  [TENANT_B],
);
// Same name on purpose - proves isolation, not just "different data happens
// not to collide".
await db.query(`INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'Website Redesign', 'active')`, [TENANT_A]);
await db.query(`INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'Website Redesign', 'active')`, [TENANT_B]);
console.log("seeded.\n");

console.log("--- proofs ---");

await check("vt_app scoped to tenant A sees only tenant A's project", async () => {
  const rows = await asRole("vt_app", TENANT_A, () => db.query(`SELECT tenant_id FROM projects`));
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].tenant_id, TENANT_A);
});

await check("vt_app scoped to tenant B sees only tenant B's project, not A's", async () => {
  const rows = await asRole("vt_app", TENANT_B, () => db.query(`SELECT tenant_id FROM projects`));
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].tenant_id, TENANT_B);
});

await check("vt_app with no tenant published sees nothing (fails closed)", async () => {
  const rows = await asRole("vt_app", "", () => db.query(`SELECT tenant_id FROM projects`));
  assert.equal(rows.rows.length, 0);
});

await check("vt_app cannot insert a row for a different tenant than its own published one (WITH CHECK)", async () => {
  await assert.rejects(
    () =>
      asRole("vt_app", TENANT_A, () =>
        db.query(`INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'Cross-tenant write', 'active')`, [TENANT_B]),
      ),
    /row-level security|permission denied/i,
  );
});

await check("vt_admin (BYPASSRLS) sees both tenants' projects regardless of app.tenant_id", async () => {
  const rows = await asRole("vt_admin", undefined, () => db.query(`SELECT tenant_id FROM projects ORDER BY tenant_id`));
  assert.equal(rows.rows.length, 2);
});

await check("vt_readonly_crosstenant can read tenant A's projects when pointed at tenant A", async () => {
  const rows = await asRole("vt_readonly_crosstenant", TENANT_A, () => db.query(`SELECT tenant_id FROM projects`));
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].tenant_id, TENANT_A);
});

await check("vt_readonly_crosstenant cannot write at all, even to its own scoped tenant (grant-level, not RLS)", async () => {
  await assert.rejects(
    () =>
      asRole("vt_readonly_crosstenant", TENANT_A, () =>
        db.query(`UPDATE projects SET name = 'hacked' WHERE tenant_id = $1`, [TENANT_A]),
      ),
    /permission denied/i,
  );
});

await check("vt_app has zero privileges on the control-plane tenants table", async () => {
  await assert.rejects(
    () => asRole("vt_app", TENANT_A, () => db.query(`SELECT * FROM tenants`)),
    /permission denied/i,
  );
});

await check("vt_readonly_crosstenant has zero privileges on verification_codes (control-plane, not business data)", async () => {
  await assert.rejects(
    () => asRole("vt_readonly_crosstenant", TENANT_A, () => db.query(`SELECT * FROM verification_codes`)),
    /permission denied/i,
  );
});

await check("vt_app and vt_readonly_crosstenant store a SCRAM verifier - never plaintext - with least privilege", async () => {
  const rows = await db.query(
    `SELECT rolname, rolpassword, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole
       FROM pg_authid WHERE rolname IN ('vt_app', 'vt_readonly_crosstenant') ORDER BY rolname`,
  );
  assert.equal(rows.rows.length, 2);
  for (const r of rows.rows) {
    assert.match(r.rolpassword ?? "", /^SCRAM-SHA-256\$4096:/, `${r.rolname} has a SCRAM verifier`);
    assert.equal(r.rolcanlogin, true);
    assert.equal(r.rolsuper, false);
    assert.equal(r.rolbypassrls, false);
    assert.equal(r.rolcreaterole, false);
  }
});

await check("views apply RLS as the caller: vt_app sees only its own tenant's members through v_members_enriched", async () => {
  await db.query(
    `INSERT INTO members (tenant_id, first_name, work_email) VALUES ($1, 'Ann', 'ann@a.test'), ($2, 'Bob', 'bob@b.test')`,
    [TENANT_A, TENANT_B],
  );
  const asA = await asRole("vt_app", TENANT_A, () => db.query(`SELECT work_email FROM v_members_enriched ORDER BY work_email`));
  assert.deepEqual(asA.rows.map((r) => r.work_email), ["ann@a.test"]);
  const asNone = await asRole("vt_app", "", () => db.query(`SELECT count(*)::int AS n FROM v_members_enriched`));
  assert.equal(asNone.rows[0].n, 0, "no tenant published must see nothing through the view either");
});

await check("tenant_seat_limit() gives vt_app the one number the seat check needs, and nothing else from tenants", async () => {
  const limit = await asRole("vt_app", TENANT_A, () => db.query(`SELECT tenant_seat_limit($1) AS n`, [TENANT_A]));
  assert.equal(limit.rows[0].n, 10);
  await assert.rejects(
    () => asRole("vt_app", TENANT_A, () => db.query(`SELECT granted_role FROM tenants WHERE id = $1`, [TENANT_A])),
    /permission denied/i,
  );
});

await check("vt_app can take the seat lock and read its limit inside one transaction (no tenants grant needed)", async () => {
  const { SEAT_LOCK_SQL } = await import("../src/modules/customer-accounts/seat-usage.service.js");
  await asRole("vt_app", TENANT_A, async () => {
    await db.query("BEGIN");
    try {
      await db.query(SEAT_LOCK_SQL, [TENANT_A]);
      const r = await db.query(`SELECT tenant_seat_limit($1) AS n`, [TENANT_A]);
      assert.equal(r.rows[0].n, 10);
      const held = await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`);
      assert.ok(held.rows[0].n >= 1, "the advisory lock is held for the transaction");
    } finally {
      await db.query("COMMIT");
    }
    const after = await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`);
    assert.equal(after.rows[0].n, 0, "released on commit, like FOR UPDATE");
  });
});

await check("unlock tokens round-trip through the real table, and vt_app cannot read it", async () => {
  const { issueUnlockToken, verifyUnlockToken } = await import("../src/modules/customer-accounts/unlock-token.js");
  const memberId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const token = await issueUnlockToken(memberId);
  assert.equal(await verifyUnlockToken(token, memberId), true);
  assert.equal(await verifyUnlockToken(token, TENANT_A), false);
  await assert.rejects(
    () => asRole("vt_app", TENANT_A, () => db.query(`SELECT * FROM customer_account_unlock_tokens`)),
    /permission denied/i,
  );
});

await check("client screenshot scoping: fetchPgScreenshots(projectIds) and isScreenshotInProjectsPg on the real schema", async () => {
  const { fetchPgScreenshots, isScreenshotInProjectsPg } = await import(
    "../src/lib/postgres/activity-events-postgres.service.js"
  );
  const member = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const mine = "11111111-aaaa-4aaa-8aaa-111111111111";
  const other = "22222222-bbbb-4bbb-8bbb-222222222222";
  const sessMine = "33333333-cccc-4ccc-8ccc-333333333333";
  const sessOther = "44444444-dddd-4ddd-8ddd-444444444444";
  await db.query(`INSERT INTO members (id, tenant_id, first_name, work_email) VALUES ($1, $2, 'Shot', 'shot@a.test')`, [member, TENANT_A]);
  await db.query(`INSERT INTO projects (id, tenant_id, name, status) VALUES ($1, $3, 'Mine', 'active'), ($2, $3, 'Other', 'active')`, [mine, other, TENANT_A]);
  await db.query(
    `INSERT INTO activity_sessions (id, tenant_id, member_id, project_id, status, ended_at)
     VALUES ($1, $3, $4, $5, 'stopped', now()), ($2, $3, $4, $6, 'stopped', now())`,
    [sessMine, sessOther, TENANT_A, member, mine, other],
  );
  await db.query(
    `INSERT INTO activity_screenshots (tenant_id, member_id, session_id, app_name, captured_at)
     VALUES ($1, $2, $3, 'Figma', now()), ($1, $2, $4, 'Slack', now())`,
    [TENANT_A, member, sessMine, sessOther],
  );
  const scoped = await fetchPgScreenshots([member], "", 50, { projectIds: [mine] });
  assert.deepEqual(scoped.map((r) => r.app_name), ["Figma"], "only the client's project");
  assert.equal((await fetchPgScreenshots([member], "", 50, { projectIds: [] })).length, 0, "no projects -> nothing, not everything");
  assert.equal((await fetchPgScreenshots([member], "", 50, {})).length, 2, "unscoped viewers still see both");
  const shots = await db.query(`SELECT id, app_name FROM activity_screenshots ORDER BY app_name`);
  const figma = shots.rows.find((r) => r.app_name === "Figma").id;
  const slack = shots.rows.find((r) => r.app_name === "Slack").id;
  assert.equal(await isScreenshotInProjectsPg(figma, [mine]), true);
  assert.equal(await isScreenshotInProjectsPg(slack, [mine]), false, "another project's capture is not reachable by id");
  assert.equal(await isScreenshotInProjectsPg(figma, []), false);
});

await check("the team-lead and member-relation SQL only uses columns team_members really has", async () => {
  // These once selected a team_members.role column that never existed: the
  // agent workspace 500'd for everyone and the member list lost its team
  // columns (that query's failure was swallowed). Same statements as
  // http/team-edit-access.js and member-list-enrichment.js.
  const lead = "55555555-eeee-4eee-8eee-555555555555";
  const team = "66666666-ffff-4fff-8fff-666666666666";
  await db.query(`INSERT INTO members (id, tenant_id, first_name, work_email) VALUES ($1, $2, 'Lead', 'lead@a.test')`, [lead, TENANT_A]);
  await db.query(`INSERT INTO teams (id, tenant_id, name) VALUES ($1, $2, 'Core')`, [team, TENANT_A]);
  await db.query(`INSERT INTO team_members (tenant_id, team_id, member_id, is_lead) VALUES ($1, $2, $3, true)`, [TENANT_A, team, lead]);
  const led = await db.query("SELECT team_id FROM team_members WHERE member_id = $1 AND is_lead = true", [lead]);
  assert.equal(led.rows.length, 1);
  const isLead = await db.query("SELECT 1 FROM team_members WHERE team_id = $1 AND member_id = $2 AND is_lead = true LIMIT 1", [team, lead]);
  assert.equal(isLead.rows.length, 1);
  const rel = await db.query("SELECT id, team_id, member_id, is_lead FROM team_members WHERE member_id = ANY($1)", [[lead]]);
  assert.equal(rel.rows.length, 1);
});

console.log(`\n${failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures} proof(s) failed)`}`);
process.exit(failures === 0 ? 0 : 1);
