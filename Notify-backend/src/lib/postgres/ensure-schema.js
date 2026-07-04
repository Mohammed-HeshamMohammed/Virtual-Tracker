// CREATE IF NOT EXISTS for notification_deliveries when POSTGRES_URL is set.
import pg from "pg";
import { getEnv } from "../../config/env.js";

const SCHEMA_DDL = [
  "CREATE EXTENSION IF NOT EXISTS pgcrypto",
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'push', 'sms')),
  template            TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  recipient_member_id TEXT,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message       TEXT,
  metadata            JSONB,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_notification_deliveries_dedup
  ON notification_deliveries (recipient, template, channel, status, sent_at DESC)`,
];

/**
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
export async function ensureNotifySchema() {
  const url = getEnv().postgres.url;
  if (!url) return { ok: true, skipped: true };

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const client = await pool.connect();
    try {
      for (const statement of SCHEMA_DDL) {
        await client.query(statement);
      }
      return { ok: true };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await pool.end();
  }
}
