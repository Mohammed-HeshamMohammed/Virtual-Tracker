import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { markPostgresLookupReady, resetPostgresLookupReadyCache } from "./lookup-availability.js";
import { markPostgresMemberDataReady, resetPostgresMemberDataReadyCache } from "./member-data-availability.js";

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

const MEMBER_DATA_DDL = [
  `CREATE TABLE IF NOT EXISTS limits (
  member_id   UUID          PRIMARY KEY,
  weekly      NUMERIC(8, 2) NOT NULL DEFAULT 0,
  daily       NUMERIC(8, 2) NOT NULL DEFAULT 0,
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS time_settings (
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id                       UUID         NOT NULL UNIQUE,
  able_to_track_time              BOOLEAN      NOT NULL DEFAULT true,
  keep_idle_time                  VARCHAR(30)  NOT NULL DEFAULT 'never',
  idle_timeout                    VARCHAR(30)  NOT NULL DEFAULT '5 min',
  modify_time                     VARCHAR(30)  NOT NULL DEFAULT 'off',
  require_approval                BOOLEAN      NOT NULL DEFAULT false,
  work_days                       JSONB        NOT NULL DEFAULT '[0, 1, 2, 3, 4]'::jsonb,
  disable_tracking_specific_days  BOOLEAN      NOT NULL DEFAULT false,
  use_shifts_for_limits           BOOLEAN      NOT NULL DEFAULT false,
  updated_by                      VARCHAR(255),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_time_settings_member ON time_settings (member_id)",
  `CREATE TABLE IF NOT EXISTS employment (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id            UUID          NOT NULL UNIQUE,
  job_title_id         UUID,
  department_id        UUID,
  job_type_id          UUID,
  tax_type_id          UUID,
  work_address         TEXT          NOT NULL DEFAULT '',
  mailing_address      BOOLEAN       NOT NULL DEFAULT false,
  employment_type      VARCHAR(120)  NOT NULL DEFAULT '',
  employed_through     VARCHAR(120)  NOT NULL DEFAULT '',
  workplace_model      VARCHAR(120)  NOT NULL DEFAULT '',
  pct_in_office        NUMERIC(5, 2) NOT NULL DEFAULT 0,
  pct_remote           NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_info             TEXT          NOT NULL DEFAULT '',
  account_code         VARCHAR(120)  NOT NULL DEFAULT '',
  currency             VARCHAR(10)   NOT NULL DEFAULT 'USD',
  start_date           DATE,
  end_date             DATE,
  termination_reason   VARCHAR(120)  NOT NULL DEFAULT '',
  employment_comments  TEXT          NOT NULL DEFAULT '',
  created_by           VARCHAR(255),
  updated_by           VARCHAR(255),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_employment_member ON employment (member_id)",
  `CREATE TABLE IF NOT EXISTS member_bans (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             UUID         NOT NULL,
  member_name           VARCHAR(255) NOT NULL DEFAULT '',
  email                 VARCHAR(255) NOT NULL DEFAULT '',
  firebase_uid          VARCHAR(128) NOT NULL DEFAULT '',
  reason                TEXT         NOT NULL,
  ip_address            VARCHAR(45)  NOT NULL DEFAULT '',
  active                BOOLEAN      NOT NULL DEFAULT true,
  banned_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  banned_by_member_id   VARCHAR(255),
  banned_by_name        VARCHAR(255),
  email_sent            BOOLEAN      NOT NULL DEFAULT false,
  revoked_at            TIMESTAMPTZ,
  revoked_by_member_id  VARCHAR(255),
  revoked_by_name       VARCHAR(255)
)`,
  "CREATE INDEX IF NOT EXISTS idx_member_bans_active_email ON member_bans (email) WHERE active = true",
  "CREATE INDEX IF NOT EXISTS idx_member_bans_active_member ON member_bans (member_id) WHERE active = true",
  "CREATE INDEX IF NOT EXISTS idx_member_bans_active_uid ON member_bans (firebase_uid) WHERE active = true",
  `CREATE TABLE IF NOT EXISTS device_bans (
  ip_address            VARCHAR(45) PRIMARY KEY,
  ban_count             INT         NOT NULL DEFAULT 0,
  banned_member_ids     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  permanently_banned    BOOLEAN     NOT NULL DEFAULT false,
  permanently_banned_at TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS system_meta (
  doc_key    VARCHAR(120) PRIMARY KEY,
  payload    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS member_tree_cache (
  member_id    UUID        PRIMARY KEY,
  ancestors    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  descendants  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  root_id      UUID,
  depth        INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `DROP TRIGGER IF EXISTS trg_limits_updated_at ON limits`,
  `CREATE TRIGGER trg_limits_updated_at
  BEFORE UPDATE ON limits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_time_settings_updated_at ON time_settings`,
  `CREATE TRIGGER trg_time_settings_updated_at
  BEFORE UPDATE ON time_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_employment_updated_at ON employment`,
  `CREATE TRIGGER trg_employment_updated_at
  BEFORE UPDATE ON employment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_system_meta_updated_at ON system_meta`,
  `CREATE TRIGGER trg_system_meta_updated_at
  BEFORE UPDATE ON system_meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_member_tree_cache_updated_at ON member_tree_cache`,
  `CREATE TRIGGER trg_member_tree_cache_updated_at
  BEFORE UPDATE ON member_tree_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_device_bans_updated_at ON device_bans`,
  `CREATE TRIGGER trg_device_bans_updated_at
  BEFORE UPDATE ON device_bans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
];

// CREATE IF NOT EXISTS for roles, lookups, time entries, timesheets, and member-domain tables.
export async function ensurePostgresLookupSchema() {
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }

  const pool = getPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  resetPostgresLookupReadyCache();
  resetPostgresMemberDataReadyCache();
  const client = await pool.connect();
  try {
    for (const statement of [...LOOKUP_DDL, ...MEMBER_DATA_DDL]) {
      await client.query(statement);
    }
    markPostgresLookupReady();
    markPostgresMemberDataReady();
    return { ok: true };
  } catch (err) {
    logSafeWarn("[postgres] ensure lookup schema failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}
