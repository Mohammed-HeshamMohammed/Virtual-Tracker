import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { markPostgresLookupReady, resetPostgresLookupReadyCache } from "./lookup-availability.js";

const LOOKUP_DDL = [
  "CREATE EXTENSION IF NOT EXISTS pgcrypto",
  `CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
  `CREATE TABLE IF NOT EXISTS roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(60) NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  VARCHAR(255),
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_roles_name ON roles (name)",
  `CREATE TABLE IF NOT EXISTS lookup_tables (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category     VARCHAR(20) NOT NULL CHECK (category IN (
                  'job_title', 'department', 'job_type', 'tax_type'
               )),
  name         VARCHAR(120) NOT NULL,
  list_ranking VARCHAR(20),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   VARCHAR(255),
  updated_by   VARCHAR(255),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lookup_category_name UNIQUE (category, name)
)`,
  "CREATE INDEX IF NOT EXISTS idx_lookup_category ON lookup_tables (category, list_ranking)",
  `CREATE TABLE IF NOT EXISTS org_field_options (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         VARCHAR(30) NOT NULL CHECK (type IN (
                  'jobTitle', 'department', 'jobType', 'employmentType',
                  'employedThrough', 'workplaceModel', 'taxType', 'terminationReason'
               )),
  label        VARCHAR(120) NOT NULL,
  position     INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by  VARCHAR(120),
  CONSTRAINT uq_org_field_type_label UNIQUE (type, label)
)`,
  "CREATE INDEX IF NOT EXISTS idx_org_field_type ON org_field_options (type, position)",
  `DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles`,
  `CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_lookup_tables_updated_at ON lookup_tables`,
  `CREATE TRIGGER trg_lookup_tables_updated_at
  BEFORE UPDATE ON lookup_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_org_field_options_updated_at ON org_field_options`,
  `CREATE TRIGGER trg_org_field_options_updated_at
  BEFORE UPDATE ON org_field_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TABLE IF NOT EXISTS time_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID        NOT NULL,
  project_id   UUID        NOT NULL,
  task_id      UUID,
  date         DATE        NOT NULL,
  start_time   TIME,
  end_time     TIME,
  duration     INTEGER     NOT NULL DEFAULT 0,
  description  TEXT,
  billable     BOOLEAN     NOT NULL DEFAULT false,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by   VARCHAR(255),
  updated_by   VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_te_member_date    ON time_entries (member_id, date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_te_project_date   ON time_entries (project_id, date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_te_member_project ON time_entries (member_id, project_id)",
  "CREATE INDEX IF NOT EXISTS idx_te_task           ON time_entries (task_id) WHERE task_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_te_status         ON time_entries (status)",
  "CREATE INDEX IF NOT EXISTS idx_te_date_range     ON time_entries (date)",
  `CREATE TABLE IF NOT EXISTS timesheets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID        NOT NULL,
  period_start    DATE        NOT NULL,
  period_end      DATE        NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  total_hours     NUMERIC(8,2),
  billable_hours  NUMERIC(8,2),
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_timesheet_member_period UNIQUE (member_id, period_start, period_end)
)`,
  "CREATE INDEX IF NOT EXISTS idx_ts_member        ON timesheets (member_id)",
  "CREATE INDEX IF NOT EXISTS idx_ts_period        ON timesheets (period_start, period_end)",
  "CREATE INDEX IF NOT EXISTS idx_ts_status        ON timesheets (status)",
  "CREATE INDEX IF NOT EXISTS idx_ts_member_status ON timesheets (member_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_ts_approved_by   ON timesheets (approved_by) WHERE approved_by IS NOT NULL",
  `DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries`,
  `CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_timesheets_updated_at ON timesheets`,
  `CREATE TRIGGER trg_timesheets_updated_at
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  // Pre-existing databases created before actor-id columns were widened from UUID to
  // VARCHAR(255) — Firebase Auth uids (28-char alphanumeric) never fit the UUID type.
  // These ALTERs are no-ops once a column is already VARCHAR.
  "ALTER TABLE roles ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE roles ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE lookup_tables ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE lookup_tables ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE time_entries ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE time_entries ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE timesheets ALTER COLUMN approved_by TYPE VARCHAR(255) USING approved_by::text",
];

/**
 * Ensures core Postgres tables (roles, lookups, time entries, timesheets) exist
 * when POSTGRES_URL is configured. Safe to run on every startup (idempotent).
 */
export async function ensurePostgresLookupSchema() {
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }

  const pool = getPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  resetPostgresLookupReadyCache();
  const client = await pool.connect();
  try {
    for (const statement of LOOKUP_DDL) {
      await client.query(statement);
    }
    markPostgresLookupReady();
    return { ok: true };
  } catch (err) {
    logSafeWarn("[postgres] ensure lookup schema failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}
