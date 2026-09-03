import pg from "pg";
import { getEnv } from "../../config/env.js";

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
