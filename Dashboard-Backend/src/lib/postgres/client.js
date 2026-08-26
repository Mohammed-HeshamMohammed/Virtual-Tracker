import pg from "pg";
import { getEnv } from "../../config/env.js";

/** @type {pg.Pool | null} */
let pool = null;

/**
 * @returns {pg.Pool | null}
 */
export function getPostgresPool() {
  const url = getEnv().postgres.url;
  if (!url) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: url });
    // 4.13: every `::date` cast (day-boundary filters for screenshots/app-logs/
    // url-logs/rollups) resolved in whatever the server's default session
    // timezone happened to be - never set explicitly, so implicit and
    // undocumented rather than genuinely wrong. Pinning it to UTC on every new
    // physical connection makes day-boundary math deterministic.
    //
    // UTC is the storage/transport baseline, NOT how tracked activity is
    // attributed to a day: the Activity feeds bucket each row by the tracked
    // member's own timezone (members.timezone, joined per row - see
    // activity-events-postgres.service.js's localDay()), so a capture near a
    // member's local midnight lands on the day they actually worked it.
    // Anything else added here that buckets by day should do the same rather
    // than take a bare `::date` off this UTC session.
    pool.on("connect", (client) => {
      client.query("SET TIME ZONE 'UTC'").catch(() => {});
    });
  }
  return pool;
}

/**
 * @returns {boolean}
 */
export function isPostgresConfigured() {
  const url = getEnv().postgres.url;
  return Boolean(url);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function query(sql, params = []) {
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  const client = await activePool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a single BEGIN/COMMIT, rolling back on any thrown error -
 * for callers that need more than one statement (e.g. two different tables)
 * to succeed or fail together, which the one-shot `query()` above can't do.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const activePool = getPostgresPool();
  if (!activePool) {
    throw new Error("POSTGRES_URL is not configured");
  }
  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
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

/**
 * @returns {Promise<boolean>}
 */
export async function probePostgresReadiness() {
  if (!isPostgresConfigured()) return true;
  try {
    await query("SELECT 1 AS ok");
    return true;
  } catch {
    return false;
  }
}

/** @internal Tests only */
export async function __closePostgresPoolForTests() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
