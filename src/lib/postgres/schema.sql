-- Virtual Tracker — PostgreSQL schema reference (time_entries, timesheets,
-- notifications, activity_* tables, etc.).
--
-- Reference only — nothing here needs to be run by hand. Every table/index/
-- column below is also applied automatically on server start by
-- src/lib/postgres/ensure-lookup-schema.js, which is the real source of
-- truth. Keep the two in sync when changing either.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS time_entries (
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
);

CREATE INDEX IF NOT EXISTS idx_te_member_date    ON time_entries (member_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_te_project_date   ON time_entries (project_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_te_member_project ON time_entries (member_id, project_id);
CREATE INDEX IF NOT EXISTS idx_te_task           ON time_entries (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_status         ON time_entries (status);
CREATE INDEX IF NOT EXISTS idx_te_date_range     ON time_entries (date);

CREATE TABLE IF NOT EXISTS timesheets (
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
);

CREATE INDEX IF NOT EXISTS idx_ts_member        ON timesheets (member_id);
CREATE INDEX IF NOT EXISTS idx_ts_period        ON timesheets (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_ts_status        ON timesheets (status);
CREATE INDEX IF NOT EXISTS idx_ts_member_status ON timesheets (member_id, status);
CREATE INDEX IF NOT EXISTS idx_ts_approved_by   ON timesheets (approved_by) WHERE approved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_timesheets_updated_at ON timesheets;
CREATE TRIGGER trg_timesheets_updated_at
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Static lookup reference data (migrated from Firestore roles / job_titles / …)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(60)  NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  VARCHAR(255),
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles (name);

CREATE TABLE IF NOT EXISTS lookup_tables (
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
);

CREATE INDEX IF NOT EXISTS idx_lookup_category ON lookup_tables (category, list_ranking);

CREATE TABLE IF NOT EXISTS org_field_options (
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
);

CREATE INDEX IF NOT EXISTS idx_org_field_type ON org_field_options (type, position);

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_lookup_tables_updated_at ON lookup_tables;
CREATE TRIGGER trg_lookup_tables_updated_at
  BEFORE UPDATE ON lookup_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_org_field_options_updated_at ON org_field_options;
CREATE TRIGGER trg_org_field_options_updated_at
  BEFORE UPDATE ON org_field_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Member profile extensions (migrated from Firestore; members stay in Firestore)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS limits (
  member_id   UUID          PRIMARY KEY,
  weekly      NUMERIC(8, 2) NOT NULL DEFAULT 0,
  daily       NUMERIC(8, 2) NOT NULL DEFAULT 0,
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_settings (
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
);

CREATE INDEX IF NOT EXISTS idx_time_settings_member ON time_settings (member_id);

CREATE TABLE IF NOT EXISTS employment (
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
);

CREATE INDEX IF NOT EXISTS idx_employment_member ON employment (member_id);

CREATE TABLE IF NOT EXISTS member_bans (
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
);

CREATE INDEX IF NOT EXISTS idx_member_bans_active_email ON member_bans (email) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_member_bans_active_member ON member_bans (member_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_member_bans_active_uid ON member_bans (firebase_uid) WHERE active = true;

CREATE TABLE IF NOT EXISTS device_bans (
  ip_address            VARCHAR(45) PRIMARY KEY,
  ban_count             INT         NOT NULL DEFAULT 0,
  banned_member_ids     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  permanently_banned    BOOLEAN     NOT NULL DEFAULT false,
  permanently_banned_at TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_meta (
  doc_key    VARCHAR(120) PRIMARY KEY,
  payload    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_tree_cache (
  member_id    UUID        PRIMARY KEY,
  ancestors    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  descendants  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  root_id      UUID,
  depth        INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_limits_updated_at ON limits;
CREATE TRIGGER trg_limits_updated_at
  BEFORE UPDATE ON limits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_time_settings_updated_at ON time_settings;
CREATE TRIGGER trg_time_settings_updated_at
  BEFORE UPDATE ON time_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employment_updated_at ON employment;
CREATE TRIGGER trg_employment_updated_at
  BEFORE UPDATE ON employment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_system_meta_updated_at ON system_meta;
CREATE TRIGGER trg_system_meta_updated_at
  BEFORE UPDATE ON system_meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_member_tree_cache_updated_at ON member_tree_cache;
CREATE TRIGGER trg_member_tree_cache_updated_at
  BEFORE UPDATE ON member_tree_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_device_bans_updated_at ON device_bans;
CREATE TRIGGER trg_device_bans_updated_at
  BEFORE UPDATE ON device_bans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-member task timer mirror (Firestore remains source of truth until cutover)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('to_do', 'in_progress', 'in_review', 'completed');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS task_member_progress (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                UUID NOT NULL,
  member_id              UUID NOT NULL,
  active_seconds         BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  idle_seconds           BIGINT NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
  progress_percentage    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0),
  accumulated_work_time  BIGINT NOT NULL DEFAULT 0 CHECK (accumulated_work_time >= 0),
  last_started_at        TIMESTAMPTZ,
  last_activity_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_tmp_task_id   ON task_member_progress (task_id);
CREATE INDEX IF NOT EXISTS idx_tmp_member_id ON task_member_progress (member_id);

CREATE TABLE IF NOT EXISTS timer_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL,
  member_id             UUID NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  active_seconds        BIGINT,
  idle_seconds          BIGINT,
  source                TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'desktop_agent')),
  activity_session_id   VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_ts_task_member ON timer_sessions (task_id, member_id);
CREATE INDEX IF NOT EXISTS idx_ts_open ON timer_sessions (member_id, task_id) WHERE ended_at IS NULL;

CREATE OR REPLACE VIEW task_progress_aggregate AS
SELECT
  task_id,
  SUM(active_seconds) AS total_active_seconds,
  SUM(idle_seconds)   AS total_idle_seconds,
  COUNT(DISTINCT member_id) AS contributing_members
FROM task_member_progress
GROUP BY task_id;

DROP TRIGGER IF EXISTS trg_tmp_updated_at ON task_member_progress;
CREATE TRIGGER trg_tmp_updated_at
  BEFORE UPDATE ON task_member_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Activity capture (screenshots, apps, URLs)

CREATE TABLE IF NOT EXISTS activity_screenshots (
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
);

-- Existing installs: widen screenshot_url to nullable and add the bytea column.
ALTER TABLE activity_screenshots ALTER COLUMN screenshot_url DROP NOT NULL;
ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS image_data BYTEA;

CREATE INDEX IF NOT EXISTS idx_act_ss_member_captured ON activity_screenshots (member_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_ss_session ON activity_screenshots (session_id);
CREATE INDEX IF NOT EXISTS idx_act_ss_captured ON activity_screenshots (captured_at DESC);

-- Shared app-name dimension: one row per distinct app across every member, so
-- activity_app_logs stores a small app_id instead of repeating the name text.
CREATE TABLE IF NOT EXISTS apps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_app_logs (
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
);

CREATE INDEX IF NOT EXISTS idx_act_app_member_started ON activity_app_logs (member_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_app_started ON activity_app_logs (started_at DESC);
-- Used to find the still-open row for the same app+tab in a session, to extend
-- its duration instead of inserting a brand-new row on every capture tick.
CREATE INDEX IF NOT EXISTS idx_act_app_session_open ON activity_app_logs (session_id, app_id, page_title, started_at DESC);

CREATE TABLE IF NOT EXISTS activity_url_logs (
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
);

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID        NOT NULL,
  type         VARCHAR(60) NOT NULL DEFAULT 'system',
  title        VARCHAR(300) NOT NULL,
  message      TEXT        NOT NULL,
  link         TEXT        NOT NULL DEFAULT '',
  read         BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient_created ON notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_recipient_unread  ON notifications (recipient_id, read) WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_act_url_member_visited ON activity_url_logs (member_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_url_visited ON activity_url_logs (visited_at DESC);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID NOT NULL,
  task_id        UUID,
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'stopped')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds   INTEGER NOT NULL DEFAULT 0,
  source         VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_act_sess_member ON activity_sessions (member_id);
CREATE INDEX IF NOT EXISTS idx_act_sess_member_open ON activity_sessions (member_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_act_sess_member_started ON activity_sessions (member_id, started_at DESC);

CREATE TABLE IF NOT EXISTS activity_alert_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_member_id UUID NOT NULL,
  alert_type        VARCHAR(60) NOT NULL,
  recipient_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_act_alert_subject_type ON activity_alert_log (subject_member_id, alert_type, sent_at DESC);

CREATE TABLE IF NOT EXISTS agent_link_sessions (
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
);
