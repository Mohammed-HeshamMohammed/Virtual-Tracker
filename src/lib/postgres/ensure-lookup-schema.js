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
  source       VARCHAR(20) NOT NULL DEFAULT 'manual'
                           CHECK (source IN ('manual', 'tracked')),
  created_by   VARCHAR(255),
  updated_by   VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  // Pre-existing databases created before `source` existed - every row time_entries has ever
  // held came from the manual-entry form, so backfilling 'manual' is exactly correct, not a guess.
  "ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual'",
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
  `CREATE TABLE IF NOT EXISTS notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID        NOT NULL,
  type         VARCHAR(60) NOT NULL DEFAULT 'system',
  title        VARCHAR(300) NOT NULL,
  message      TEXT        NOT NULL,
  link         TEXT        NOT NULL DEFAULT '',
  read         BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_recipient_created ON notifications (recipient_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_recipient_unread ON notifications (recipient_id, read) WHERE read = false`,
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
  `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('to_do', 'in_progress', 'in_review', 'completed');
    END IF;
END$$`,
  `CREATE TABLE IF NOT EXISTS task_member_progress (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                UUID NOT NULL,
  member_id              UUID NOT NULL,
  active_seconds         BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  idle_seconds           BIGINT NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
  progress_percentage    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0),
  last_started_at        TIMESTAMPTZ,
  last_activity_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, member_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_tmp_task_id ON task_member_progress (task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tmp_member_id ON task_member_progress (member_id)`,
  `CREATE OR REPLACE VIEW task_progress_aggregate AS
SELECT
  task_id,
  SUM(active_seconds) AS total_active_seconds,
  SUM(idle_seconds)   AS total_idle_seconds,
  COUNT(DISTINCT member_id) AS contributing_members
FROM task_member_progress
GROUP BY task_id`,
  `DROP TRIGGER IF EXISTS trg_tmp_updated_at ON task_member_progress`,
  `CREATE TRIGGER trg_tmp_updated_at
  BEFORE UPDATE ON task_member_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TABLE IF NOT EXISTS activity_screenshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL,
  session_id       VARCHAR(128) NOT NULL,
  task_id          UUID,
  task_title       VARCHAR(500),
  screenshot_url   TEXT,
  image_data       BYTEA,
  has_image        BOOLEAN NOT NULL DEFAULT true,
  app_name         VARCHAR(200) NOT NULL DEFAULT 'Browser',
  page_title       VARCHAR(300) NOT NULL DEFAULT '',
  activity_level   INTEGER NOT NULL DEFAULT 50 CHECK (activity_level >= 0 AND activity_level <= 100),
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))
)`,
  // Already-existing (pre-bytea) tables: widen and add the new column in place.
  `ALTER TABLE activity_screenshots ALTER COLUMN screenshot_url DROP NOT NULL`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS image_data BYTEA`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_member_captured ON activity_screenshots (member_id, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_session ON activity_screenshots (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_captured ON activity_screenshots (captured_at DESC)`,
  // Shared app-name dimension: one row per distinct app across every member, so
  // activity_app_logs stores a small app_id instead of repeating the name text.
  `CREATE TABLE IF NOT EXISTS apps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS activity_app_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL,
  session_id       VARCHAR(128) NOT NULL,
  task_id          UUID,
  task_title       VARCHAR(500),
  app_id           UUID NOT NULL REFERENCES apps(id),
  page_title       VARCHAR(300) NOT NULL DEFAULT '',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds >= 0),
  source           VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_act_app_member_started ON activity_app_logs (member_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_act_app_started ON activity_app_logs (started_at DESC)`,
  // Used to find the still-open row for the same app+tab in a session, to extend
  // its duration instead of inserting a brand-new row on every capture tick.
  `CREATE INDEX IF NOT EXISTS idx_act_app_session_open ON activity_app_logs (session_id, app_id, page_title, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_url_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL,
  session_id       VARCHAR(128) NOT NULL,
  task_id          UUID,
  task_title       VARCHAR(500),
  url              TEXT NOT NULL,
  domain           VARCHAR(255) NOT NULL DEFAULT '',
  page_title       VARCHAR(300) NOT NULL DEFAULT '',
  visited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds >= 0),
  source           VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_act_url_member_visited ON activity_url_logs (member_id, visited_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_act_url_visited ON activity_url_logs (visited_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID NOT NULL,
  task_id        UUID,
  project_id     UUID,
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'stopped')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds   INTEGER NOT NULL DEFAULT 0,
  source         VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  // Pre-existing databases created before `source` existed on this table.
  `ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))`,
  // Calling-project sessions have no task to derive a project from.
  `ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS project_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_project ON activity_sessions (project_id) WHERE project_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member ON activity_sessions (member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member_open ON activity_sessions (member_id) WHERE ended_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member_started ON activity_sessions (member_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_alert_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_member_id UUID NOT NULL,
  alert_type        VARCHAR(60) NOT NULL,
  recipient_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_act_alert_subject_type ON activity_alert_log (subject_member_id, alert_type, sent_at DESC)`,
  // ─── Projects domain (migrated from Firestore - see PROPOSAL-Projects-Migration-to-PostgreSQL.md) ───
  // Column set pulled from the live Firestore field catalog
  // (src/modules/schema/catalog/{projects,clients,teams}/index.js), not invented.
  // The FK from time_entries.project_id is deliberately NOT added here - it
  // would fail on any database still holding orphaned project_id values and
  // block everything listed after it in this array (this loop stops at the
  // first failing statement).
  `CREATE TABLE IF NOT EXISTS projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    VARCHAR(200) NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  billable                BOOLEAN NOT NULL DEFAULT true,
  disable_activity        BOOLEAN NOT NULL DEFAULT false,
  allow_project_tracking  BOOLEAN NOT NULL DEFAULT true,
  disable_idle_time       BOOLEAN NOT NULL DEFAULT false,
  client_id               UUID,
  managers_notes          TEXT,
  users_notes             TEXT,
  viewers_notes           TEXT,
  type                    VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (type IN ('normal', 'calling')),
  end_date                DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID,
  updated_by              UUID,
  archived_by             UUID,
  archived_at             TIMESTAMPTZ
)`,
  // Pre-existing databases created before project types existed.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'normal'`,
  // Optional, informational only (item 5 of the budget fixes plan) - not
  // required, nothing archives on it. Deliberately no start_date: created_at
  // already answers "when did this project start".
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE`,
  `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id)`,
  `CREATE TABLE IF NOT EXISTS project_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL,
  project_role  VARCHAR(40),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  updated_by    UUID,
  UNIQUE (project_id, member_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_project ON project_members (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_member ON project_members (member_id)`,
  // type/based_on/resets etc. exist in the live Firestore doc today but were never
  // read by overview-service.js - that omission is the root cause of the budget-type
  // display bug (see proposal doc "Related Bug" section). Carrying them forward here.
  //
  // scope: 'per_project' (default) = cost is a flat total, today's only prior
  // behavior. 'per_person' = cost is hours-per-member; the live total scales
  // with current headcount (Hours based: cost * member count; Cost based:
  // cost hours * each member's own rate, summed) instead of a fixed number
  // typed once.
  `CREATE TABLE IF NOT EXISTS project_budgets (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type                        VARCHAR(20) NOT NULL DEFAULT 'Cost based' CHECK (type IN ('Cost based', 'Hours based')),
  based_on                    VARCHAR(20),
  scope                       VARCHAR(20) NOT NULL DEFAULT 'per_project' CHECK (scope IN ('per_project', 'per_person')),
  cost                        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notify_project_members      BOOLEAN NOT NULL DEFAULT false,
  notify_at_pct               NUMERIC(5, 2),
  who_to_notify               VARCHAR(255),
  stop_timers_when_reached    BOOLEAN NOT NULL DEFAULT false,
  stop_timers_at_pct          NUMERIC(5, 2),
  resets                      VARCHAR(20) NOT NULL DEFAULT 'Never' CHECK (resets IN ('Never', 'Weekly', 'Monthly')),
  start_date                  DATE,
  include_non_billable_time   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_project ON project_budgets (project_id)`,
  // Pre-existing databases created before the per-person budget scope existed.
  `ALTER TABLE project_budgets ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'per_project'`,
  // Dedupe state for the notify-at-threshold check (item 4 of the budget
  // fixes plan) - one row per project, tracking which reset period a
  // notification has already gone out for. Postgres-resident (not Firestore
  // like client_automation_state) since project_budgets already is.
  `CREATE TABLE IF NOT EXISTS project_budget_notify_state (
  project_id            UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  notified_period_key   VARCHAR(40),
  notify_at_pct         NUMERIC(5, 2),
  last_usage_pct        NUMERIC(6, 2),
  last_sent_at          TIMESTAMPTZ
)`,
  // Real shape mirrors project_budgets, NOT a bare daily/weekly integer pair - matches
  // the live Firestore doc. Note: the only current reader (overview-service.js) treats
  // `cost` as a max-member headcount, not a budget amount - see proposal doc "Related
  // Bug" #6. Schema carried forward as-is; the semantic mismatch is a follow-up decision,
  // not something to silently redesign during a storage migration.
  `CREATE TABLE IF NOT EXISTS project_member_limits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id               UUID NOT NULL,
  type                    VARCHAR(20),
  based_on                VARCHAR(20),
  cost                    NUMERIC(12, 2),
  resets                  VARCHAR(20) NOT NULL DEFAULT 'Never',
  start_date              DATE,
  notify_at_pct           NUMERIC(5, 2),
  notify_project_members  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID,
  updated_by              UUID,
  UNIQUE (project_id, member_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_pml_project ON project_member_limits (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pml_member ON project_member_limits (member_id)`,
  // ─── Clients domain (migrated from Firestore, Phase 7+ of the budget fixes
  // plan - see project-budget-fixes-plan.md). Column set pulled from the live
  // Firestore field catalog (schema/catalog/clients/index.js), not invented.
  // No backfill: existing Firestore rows are not carried over, these start empty.
  `CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID,
  name            VARCHAR(200) NOT NULL,
  street_address  TEXT NOT NULL DEFAULT '',
  city            VARCHAR(120) NOT NULL DEFAULT '',
  state           VARCHAR(120) NOT NULL DEFAULT '',
  zip             VARCHAR(20)  NOT NULL DEFAULT '',
  country         VARCHAR(120) NOT NULL DEFAULT '',
  phone_number    VARCHAR(40)  NOT NULL DEFAULT '',
  email_addresses TEXT NOT NULL DEFAULT '',
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_by      UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status)`,
  `CREATE INDEX IF NOT EXISTS idx_clients_member ON clients (member_id)`,
  // Client budget vocabulary (hourly|fixed|retainer|none, per_person|per_project|
  // total) is deliberately separate from project_budgets' own (Cost based|Hours
  // based) - these are two different budget shapes, not one redesigned to match
  // the other during this migration.
  `CREATE TABLE IF NOT EXISTS client_budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('hourly', 'fixed', 'retainer', 'none')),
  based_on        VARCHAR(20) NOT NULL DEFAULT 'per_project'
                    CHECK (based_on IN ('per_person', 'per_project', 'total')),
  cost            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notify_at_pct   NUMERIC(5, 2),
  resets          VARCHAR(20) NOT NULL DEFAULT 'never'
                    CHECK (resets IN ('monthly', 'quarterly', 'yearly', 'never')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_by      UUID
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_client ON client_budgets (client_id)`,
  `CREATE TABLE IF NOT EXISTS client_invoicing (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  custom_for_client             BOOLEAN NOT NULL DEFAULT false,
  notes                         TEXT NOT NULL DEFAULT '',
  net_terms_days                INT NOT NULL DEFAULT 30,
  tax_rate                      NUMERIC(5, 2) NOT NULL DEFAULT 0,
  auto_invoicing                BOOLEAN NOT NULL DEFAULT false,
  auto_invoice_amount_based_on  VARCHAR(20) NOT NULL DEFAULT 'hourly',
  auto_fixed_amount             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  auto_invoice_frequency        VARCHAR(20) NOT NULL DEFAULT 'monthly',
  auto_invoice_delay_days       INT NOT NULL DEFAULT 0,
  auto_invoice_reminder_days    INT NOT NULL DEFAULT 7,
  auto_invoice_line_items       VARCHAR(60) NOT NULL DEFAULT 'detailed_project_user_date',
  include_non_billable_time     BOOLEAN NOT NULL DEFAULT false,
  include_expenses              BOOLEAN NOT NULL DEFAULT false,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                    UUID,
  updated_by                    UUID
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_client ON client_invoicing (client_id)`,
  // Threshold + period-key dedupe state for client budget notifications -
  // replaces the Firestore client_automation_state collection.
  `CREATE TABLE IF NOT EXISTS client_automation_state (
  client_id       UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  budget_policy   JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_at_pct   NUMERIC(5, 2),
  notified_period_key VARCHAR(40),
  last_usage_pct  NUMERIC(6, 2),
  last_sent_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS client_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  UNIQUE (client_id, project_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_cp_client ON client_projects (client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cp_project ON client_projects (project_id)`,
  // client_projects.client_id had no FK until the clients table existed above -
  // added here, after clients exists in this array, same idempotent pattern as
  // fk_tmp_task below.
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cp_client') THEN
    ALTER TABLE client_projects ADD CONSTRAINT fk_cp_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$`,
  `CREATE TABLE IF NOT EXISTS team_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  UNIQUE (team_id, project_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_tp_team ON team_projects (team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tp_project ON team_projects (project_id)`,
  `CREATE TABLE IF NOT EXISTS agent_link_sessions (
  link_token               TEXT PRIMARY KEY,
  agent_secret             TEXT NOT NULL,
  status                   VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'exchanged')),
  member_id                UUID,
  id_token                 TEXT,
  refresh_token            TEXT NOT NULL DEFAULT '',
  agent_source             VARCHAR(20) NOT NULL DEFAULT 'electron' CHECK (agent_source IN ('electron', 'python')),
  expires_at               TIMESTAMPTZ NOT NULL,
  invalid_exchange_attempts INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ
)`,
  // Long-lived per-machine agent credential. Lets a linked desktop agent
  // re-authenticate in-app after its (borrowed) Firebase refresh token dies,
  // instead of sending the user back through a browser link. Secret is stored
  // hashed only - see agent-devices.service.js.
  `CREATE TABLE IF NOT EXISTS agent_devices (
  device_id       UUID PRIMARY KEY,
  member_id       UUID NOT NULL,
  secret_hash     TEXT NOT NULL,
  agent_source    VARCHAR(20) NOT NULL DEFAULT 'tauri',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_seen_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_devices_member ON agent_devices (member_id) WHERE revoked_at IS NULL`,
  // ─── Tasks domain (Phase 2 of implementation.md - Firestore -> Postgres) ───
  // Schema-stand-up only: additive, nothing reads from these tables yet, zero
  // behavior change. Column set pulled from the live Firestore field catalog
  // (src/modules/schema/catalog/tasks/index.js), not invented. Must come after
  // the projects-domain block above in this array - both FKs reference
  // projects(id), and this loop stops at the first failing statement.
  `CREATE TABLE IF NOT EXISTS tasks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL REFERENCES projects(id),
  team_id                     UUID,
  title                       TEXT NOT NULL,
  description                 TEXT,
  status                      VARCHAR(30) NOT NULL DEFAULT 'todo',
  priority                    VARCHAR(20),
  order_index                 INT,
  duration_hours_per_day      NUMERIC(6,2),
  duration_days               INT,
  working_days                INT,
  overtime_hours_per_day      NUMERIC(6,2),
  assigned_to                 UUID,
  start_date                  TIMESTAMPTZ,
  due_date                    TIMESTAMPTZ,
  review_state                VARCHAR(20),
  reviewed_by                 UUID,
  reviewed_at                 TIMESTAMPTZ,
  total_active_seconds        BIGINT NOT NULL DEFAULT 0,
  total_idle_seconds          BIGINT NOT NULL DEFAULT 0,
  aggregated_progress_percent NUMERIC(5,2),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status ON tasks (assigned_to, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks (project_id, status)`,
  // Participation counters recomputed by task-assignments.js's recomputeTaskStatus()
  // whenever an assignment's status changes - Firestore-only ad-hoc fields (never in
  // the schema catalog, schemaless writes), carried forward here so callers reading
  // them from a Postgres task row (enrichAssignmentRow etc.) keep working.
  `ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS total_assignees INT,
    ADD COLUMN IF NOT EXISTS started_assignees INT,
    ADD COLUMN IF NOT EXISTS not_started_assignees INT,
    ADD COLUMN IF NOT EXISTS participation_percent INT,
    ADD COLUMN IF NOT EXISTS all_assignees_started BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS task_assignments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id          UUID NOT NULL,
  project_id         UUID NOT NULL REFERENCES projects(id),
  status             VARCHAR(20) NOT NULL DEFAULT 'todo',
  expected_seconds   INT,
  required           BOOLEAN NOT NULL DEFAULT true,
  review_state       VARCHAR(20),
  reviewed_by        UUID,
  reviewed_at        TIMESTAMPTZ,
  review_notes       TEXT,
  entered_review_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, member_id)
)`,
  // 4.4: every other table (task_member_progress, activity_sessions,
  // project_members) already calls this column member_id - task_assignments
  // was the one outlier still carrying Firestore's user_id naming. Renamed
  // rather than left inconsistent now that more tables/joins are piling up
  // on top of this domain. Idempotent: no-op once already renamed.
  `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_assignments' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE task_assignments RENAME COLUMN user_id TO member_id;
  END IF;
END $$`,
  `CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON task_assignments (member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_task_assignments_project ON task_assignments (project_id)`,
  // task_member_progress already exists (added earlier for the activity-data
  // migration) - extend it to cover the remaining Firestore time_tracking
  // fields instead of creating a separate table. New columns are nullable, so
  // this is safe to run against a table that already has rows: existing rows
  // simply get NULL, which trivially satisfies the FK on project_id.
  `ALTER TABLE task_member_progress
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id),
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS review_notes TEXT`,
  // task_member_progress/timer_sessions.task_id had no FK at all until now -
  // couldn't reference tasks(id) when these tables were first created (tasks
  // didn't exist yet). Added here, after tasks
  // exists in this array, with ON DELETE CASCADE so deleting a task actually
  // cleans up its progress/session rows instead of orphaning them the way
  // deleteTaskPg alone would (task_assignments already had this via its own
  // table-level FK - these two didn't). Idempotent: safe to run on every boot.
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tmp_task') THEN
    ALTER TABLE task_member_progress ADD CONSTRAINT fk_tmp_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;
END $$`,
  // ─── Phase 4 schema hardening (implementation.md) - cheap/safe items ───
  // 4.12: these 3 columns already have a UNIQUE constraint, which Postgres backs
  // with its own index - the separate explicit index below is a second index
  // maintained on every write for zero query benefit. Free to drop.
  "DROP INDEX IF EXISTS idx_roles_name",
  "DROP INDEX IF EXISTS idx_time_settings_member",
  "DROP INDEX IF EXISTS idx_employment_member",
  // 4.15: workedTodayOnTaskSeconds filters activity_sessions by task_id
  // (activity-events-postgres.service.js) but only member_id-based indexes
  // existed on this table.
  "CREATE INDEX IF NOT EXISTS idx_act_sess_task ON activity_sessions (task_id) WHERE task_id IS NOT NULL",
  // 4.5: task_status enum was declared but wired to zero columns (grepped the
  // full backend), and its values don't match real status strings in use
  // (`to_do`/`completed` vs the real `todo`/`done`/`cancelled`/`archived`) -
  // a stale, mismatched, unused type is worse than no type. tasks.status
  // stays a plain VARCHAR, which is what every reader already assumes.
  "DROP TYPE IF EXISTS task_status",
  // 4.14: has_image is hardcoded to the literal `true` on every insert
  // (activity-events-postgres.service.js's insertActivityScreenshot) and the
  // one route that creates a row (activity/routes.js) only ever reaches that
  // insert when real image data is present (`if (!imageData) continue;`) -
  // there is no path that has ever produced or could produce `false`. Dead
  // column, not future-proofing; dropped rather than carried forward.
  "ALTER TABLE activity_screenshots DROP COLUMN IF EXISTS has_image",
  // 4.1: UUIDv7 is time-sortable (same 128-bit external shape, no API-facing
  // change) unlike gen_random_uuid()'s fully random insertion order, which
  // causes btree page splits/index bloat on high-write tables - a real cost
  // on a 2-vCPU box. Only switches the DEFAULT for future inserts; existing
  // ids are untouched. No-op when uuidv7() isn't available (pre-PG17 without
  // the pg_uuidv7 extension) rather than failing the whole boot sequence.
  `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuidv7') THEN
    ALTER TABLE task_assignments ALTER COLUMN id SET DEFAULT uuidv7();
    ALTER TABLE task_member_progress ALTER COLUMN id SET DEFAULT uuidv7();
  END IF;
END $$`,
  // 4.6: sumPgMemberActiveSeconds summed a session's ENTIRE active_seconds
  // whenever started_at fell in the requested day/week range - a session
  // started at 23:50 and still open past midnight got all its seconds
  // attributed to the day it started, none to the next. These two rollups
  // are incremented by a delta (this sync's active_seconds minus the
  // session's previous active_seconds) attributed to the calendar day the
  // sync actually ran on, sidestepping the midnight-split problem entirely.
  `CREATE TABLE IF NOT EXISTS daily_member_active_seconds (
  member_id      UUID NOT NULL,
  day            DATE NOT NULL,
  active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, day)
)`,
  `CREATE TABLE IF NOT EXISTS daily_member_task_active_seconds (
  member_id      UUID NOT NULL,
  task_id        UUID NOT NULL,
  day            DATE NOT NULL,
  active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, task_id, day)
)`,
  // 4.2/4.3: timer_sessions only had one writer - syncMemberProgressToPostgres,
  // the pre-Phase-2 dual-write mirror gated behind TASK_MEMBER_PROGRESS_PG_DUAL_WRITE
  // (defaults false, never turned on in this deployment). Since task_member_progress
  // has been the real primary store since Phase 2, that whole mirror (and its
  // GREATEST-ratcheted accumulated_work_time column, never read by anything -
  // active_seconds is already correctly monotonic from the tracker itself) was
  // dead weight, not a table worth "collapsing" with activity_sessions - removed
  // outright instead, along with the mirror functions in
  // task-member-progress.service.js and the now-unused dual-write flag.
  "DROP TABLE IF EXISTS timer_sessions",
  "ALTER TABLE task_member_progress DROP COLUMN IF EXISTS accumulated_work_time",
  // 4.8: task_progress_aggregate (the view) and every reader of
  // tasks.total_active_seconds/total_idle_seconds recompute SUM(active_seconds)
  // across all members on every read - read cadence (dashboard/task-list
  // polling) far exceeds write cadence (one sync per SESSION_SYNC_INTERVAL_SEC
  // = 20s per active tracker). Trigger-maintained totals are cheaper than
  // recomputing per read, and don't depend on aggregateTaskProgress() always
  // remembering to call updateTaskPg - the same class of bug this plan
  // already found once (the pre-fbab994 quit-path gap) and shouldn't
  // reintroduce at the database layer. Redundant-but-harmless alongside the
  // existing app-level update in aggregateTaskProgress() - both converge to
  // the same SUM(), this just guarantees it even if that call site is ever
  // missed.
  `CREATE OR REPLACE FUNCTION recompute_task_totals() RETURNS TRIGGER AS $$
BEGIN
  UPDATE tasks SET
    total_active_seconds = (SELECT COALESCE(SUM(active_seconds), 0) FROM task_member_progress WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)),
    total_idle_seconds   = (SELECT COALESCE(SUM(idle_seconds), 0)   FROM task_member_progress WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_recompute_task_totals ON task_member_progress`,
  `CREATE TRIGGER trg_recompute_task_totals
  AFTER INSERT OR UPDATE OR DELETE ON task_member_progress
  FOR EACH ROW EXECUTE FUNCTION recompute_task_totals()`,
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
