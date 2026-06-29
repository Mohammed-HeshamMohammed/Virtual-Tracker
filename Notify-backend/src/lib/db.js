/**
 * PostgreSQL client for Notify-Backend.
 * Used exclusively for delivery logging — not required for core send functionality.
 * If POSTGRES_URL is not configured, all calls are silent no-ops.
 */
import pg from "pg";
import { getEnv } from "../config/env.js";

/** @type {pg.Pool | null} */
let _pool = null;
let _initAttempted = false;

function getPool() {
  if (_initAttempted) return _pool;
  _initAttempted = true;

  const url = getEnv().postgres.url;
  if (!url) return null;

  _pool = new pg.Pool({ connectionString: url, max: 3 });
  _pool.on("error", (err) => {
    console.warn("[notify-db] Pool error:", err.message);
  });

  return _pool;
}

/**
 * Run a query. Returns rows on success, null if DB is not configured or unavailable.
 * Never throws — delivery must not fail because the log is unreachable.
 *
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>[] | null>}
 */
export async function dbQuery(sql, params = []) {
  const pool = getPool();
  if (!pool) return null;

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(sql, params);
    return result.rows;
  } catch (err) {
    console.warn("[notify-db] Query error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    client?.release();
  }
}

/**
 * Verify DB connectivity at startup. Returns true if reachable.
 * @returns {Promise<boolean>}
 */
export async function verifyDbConnectivity() {
  const pool = getPool();
  if (!pool) return false;
  const rows = await dbQuery("SELECT 1 AS ok");
  return rows !== null;
}
