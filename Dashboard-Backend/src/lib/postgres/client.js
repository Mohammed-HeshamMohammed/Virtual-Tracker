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
  }
  return pool;
}

/**
 * @returns {boolean}
 */
export function isPostgresConfigured() {
  return Boolean(getEnv().postgres.url);
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
