import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Lookup DDL lives at the end of schema.sql (after time_entries / timesheets). */
function loadLookupSchemaSql() {
  const schemaPath = join(__dirname, "schema.sql");
  const full = readFileSync(schemaPath, "utf8");
  const marker = "-- Static lookup reference data";
  const idx = full.indexOf(marker);
  if (idx === -1) {
    throw new Error("Lookup schema section not found in schema.sql");
  }
  const setUpdatedAtFn = `
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;
  return `CREATE EXTENSION IF NOT EXISTS pgcrypto;\n\n${setUpdatedAtFn}\n\n${full.slice(idx)}`;
}

/**
 * Ensures lookup tables exist when POSTGRES_URL is configured.
 * Safe to run on every startup (idempotent CREATE IF NOT EXISTS).
 */
export async function ensurePostgresLookupSchema() {
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }

  const pool = getPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  const sql = loadLookupSchemaSql();
  const client = await pool.connect();
  try {
    await client.query(sql);
    return { ok: true };
  } catch (err) {
    logSafeWarn("[postgres] ensure lookup schema failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}
