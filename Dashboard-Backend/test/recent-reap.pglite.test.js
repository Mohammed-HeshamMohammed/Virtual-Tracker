// hasRecentReapForMember against real Postgres (PGlite): the evidence the day-off gate (D3) relies on.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  /* not installed */
}

if (!PGlite) {
  test("recent reap lookup (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const url = (rel) => pathToFileURL(`${SRC}/${rel}`).href;
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE activity_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid, project_id uuid, task_id uuid,
      status text, started_at timestamptz, ended_at timestamptz,
      active_seconds int NOT NULL DEFAULT 0, idle_seconds int NOT NULL DEFAULT 0,
      seed_active_seconds int NOT NULL DEFAULT 0, seed_idle_seconds int NOT NULL DEFAULT 0,
      source text, updated_at timestamptz, stop_reason text);
  `);
  const run = async (sql, params) => (await db.query(sql, params)).rows;
  mock.module(url("lib/postgres/client.js"), {
    namedExports: {
      queryRaw: async (sql, params) => db.query(sql, params),
      query: run,
      __closePostgresPoolForTests: async () => null,
      isPostgresConfigured: () => true,
      probePostgresReadiness: async () => null,
      withTransaction: async () => null,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isTenancyEnforced: () => false,
      queryAsReadonlyCrossTenant: run,
      withTransactionAsAdmin: async () => null,
      queryAsAdmin: run,
      withTenant: async (_t, fn) => fn(),
    },
  });
  mock.module(url("http/sanitize-error.js"), {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });
  const { hasRecentReapForMember } = await import(url("lib/postgres/activity-events-postgres.service.js"));

  const M = "cccccccc-0000-4000-8000-000000000001";
  const OTHER = "cccccccc-0000-4000-8000-000000000002";
  const ago = (h) => new Date(Date.now() - h * 3600_000);
  const add = (member, reason, endedAt) =>
    db.query("INSERT INTO activity_sessions (member_id, status, started_at, ended_at, stop_reason) VALUES ($1,'stopped',$2,$3,$4)", [
      member, ago(9), endedAt, reason,
    ]);

  test("a reap in the last six hours counts", async () => {
    await add(M, "abandoned_reap", ago(1));
    assert.equal(await hasRecentReapForMember(M), true);
  });

  test("another member's reap does not", async () => {
    assert.equal(await hasRecentReapForMember(OTHER), false);
  });

  test("an old reap, or a session closed for another reason, does not", async () => {
    await db.query("DELETE FROM activity_sessions");
    await add(M, "abandoned_reap", ago(7));
    await add(M, "member_stop", ago(1));
    assert.equal(await hasRecentReapForMember(M), false);
  });
}
