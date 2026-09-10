import pg from "pg";
import { getEnv } from "../../config/env.js";
import { currentAuditActor, statementMayAudit } from "./audit-actor.js";

let pool = null;

export function getPostgresPool() {
  const url = getEnv().postgres.url;
  if (!url) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: url });
    pool.on("connect", (client) => {
      client.query("SET TIME ZONE 'UTC'").catch(() => {});
    });
  }
  return pool;
}

export function isPostgresConfigured() {
  const url = getEnv().postgres.url;
  return Boolean(url);
}

/**
 * The actor currently published on a pooled connection, so the extra
 * round-trip is paid once per connection rather than once per write.
 */
const PUBLISHED_ACTOR = Symbol("vtPublishedAuditActor");

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

export async function query(sql, params = []) {
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  const client = await activePool.connect();
  try {
    await publishAuditActor(client, sql);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    // Once per transaction: SET LOCAL is scoped to it and unwinds on COMMIT or
    // ROLLBACK, so nothing leaks back into the pool.
    await client.query("SELECT set_config('app.actor_id', $1, true)", [currentAuditActor() ?? ""]);
    // ...which also means whatever `query()` cached about this connection is
    // no longer true once the transaction ends.
    delete client[PUBLISHED_ACTOR];
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
  if (pool) {
    await pool.end();
    pool = null;
  }
}
