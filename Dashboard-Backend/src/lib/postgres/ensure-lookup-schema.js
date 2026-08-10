import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { markPostgresLookupReady, resetPostgresLookupReadyCache } from "./lookup-availability.js";
import { markPostgresMemberDataReady, resetPostgresMemberDataReadyCache } from "./member-data-availability.js";
import { isActivityScreenshotsEnabled } from "../../config/activity.js";

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
  // ─── Member identity (migrated from Firestore) ──────────────────────────
  // The one collection every other migration deliberately deferred (schema.sql
  // used to say outright "members stay in Firestore" - see implementation.md
  // §4.9, "materially bigger scope than this plan"). Moved for real once an
  // accidental Firestore collection delete took the entire app down through
  // auth-middleware.js's per-request `members.where("firebase_uid", ...)`
  // lookup - every authenticated request 404'd with no recovery path, because
  // nothing in Postgres could resolve a Firebase UID back to a member without
  // that Firestore doc. This table plus the unique index below replaces both
  // the Firestore `members` collection AND `member_auth_index` (a native
  // unique index on firebase_uid does the same O(1) lookup that doc-per-uid
  // index existed for). Column set pulled from the live field catalog
  // (src/modules/schema/catalog/members/index.js) plus every field actually
  // read/written in members/services/*.js that the catalog didn't cover
  // (presence, ban, and role-change timestamps) - not invented.
  `CREATE TABLE IF NOT EXISTS members (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid              VARCHAR(128) NOT NULL DEFAULT '',
  first_name                VARCHAR(120) NOT NULL DEFAULT '',
  last_name                 VARCHAR(120) NOT NULL DEFAULT '',
  display_name              VARCHAR(250) NOT NULL DEFAULT '',
  must_change_password      BOOLEAN NOT NULL DEFAULT false,
  work_email                VARCHAR(255) NOT NULL DEFAULT '',
  personal_email            VARCHAR(255) NOT NULL DEFAULT '',
  employee_id               VARCHAR(60) NOT NULL DEFAULT '',
  phone_number               VARCHAR(40) NOT NULL DEFAULT '',
  phone_verified            BOOLEAN NOT NULL DEFAULT false,
  ip_address                VARCHAR(45) NOT NULL DEFAULT '',
  avatar_url                TEXT,
  avatar_color              VARCHAR(20),
  status                    VARCHAR(20) NOT NULL DEFAULT 'active',
  role_id                   UUID,
  hierarchy_status          VARCHAR(30),
  hierarchy_entitlements    JSONB NOT NULL DEFAULT '{}'::jsonb,
  privileges                JSONB NOT NULL DEFAULT '{}'::jsonb,
  independent_hierarchy     BOOLEAN NOT NULL DEFAULT false,
  hierarchy_status_updated_at TIMESTAMPTZ,
  roles_updated_at          TIMESTAMPTZ,
  info_updated_at           TIMESTAMPTZ,
  last_seen_at              TIMESTAMPTZ,
  profile_linked_records_at TIMESTAMPTZ,
  banned_at                 TIMESTAMPTZ,
  registration_invite_kind  VARCHAR(20),
  created_by                VARCHAR(255) NOT NULL DEFAULT '',
  created_by_uid             VARCHAR(128) NOT NULL DEFAULT '',
  updated_by                VARCHAR(255) NOT NULL DEFAULT '',
  date_added                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  // Replaces both a Firestore uniqueness-by-convention on firebase_uid and
  // the separate member_auth_index doc-per-uid collection - one real
  // constraint instead of two things that could drift apart.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_members_firebase_uid ON members (firebase_uid) WHERE firebase_uid <> ''`,
  `CREATE INDEX IF NOT EXISTS idx_members_status ON members (status)`,
  `CREATE INDEX IF NOT EXISTS idx_members_role ON members (role_id)`,
  `CREATE INDEX IF NOT EXISTS idx_members_work_email ON members (work_email) WHERE work_email <> ''`,
  `DROP TRIGGER IF EXISTS trg_members_updated_at ON members`,
  `CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_members_role') THEN
    ALTER TABLE members ADD CONSTRAINT fk_members_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
  END IF;
END $$`,
  // ─── Teams (migrated from Firestore) ─────────────────────────────────────
  // Column set from src/modules/schema/catalog/teams/index.js. team_projects
  // already moved to Postgres earlier; teams/team_members were left in
  // Firestore ("low-volume, self-contained" - PROPOSAL-Projects-Migration-
  // to-PostgreSQL.md) until the incident that took the whole members domain
  // with it forced the rest of this migration too.
  `CREATE TABLE IF NOT EXISTS teams (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(200) NOT NULL,
  schedule_weekly_report      BOOLEAN NOT NULL DEFAULT false,
  last_weekly_report_sent_at  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_name ON teams (name)`,
  `CREATE TABLE IF NOT EXISTS team_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL,
  is_lead       BOOLEAN NOT NULL DEFAULT false,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  updated_by    UUID,
  UNIQUE (team_id, member_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members (team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members (member_id)`,
  // team_projects.team_id has carried no FK since it predates this table
  // (see deleteTeamProjectsForTeamPg's own comment) - add it now that teams
  // exists, same idempotent DO-block pattern already used for fk_cp_client.
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tp_team') THEN
    ALTER TABLE team_projects ADD CONSTRAINT fk_tp_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$`,
  // ─── Invites (migrated from Firestore) ───────────────────────────────────
  // Column set from schema/catalog/members/index.js, widened with the real
  // fields member-invites.routes.js actually reads/writes that the catalog
  // didn't cover (phone_number, invite fan-out timestamps).
  `CREATE TABLE IF NOT EXISTS invites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) NOT NULL DEFAULT '',
  first_name        VARCHAR(120) NOT NULL DEFAULT '',
  last_name         VARCHAR(120) NOT NULL DEFAULT '',
  phone_number      VARCHAR(40) NOT NULL DEFAULT '',
  role_id           UUID,
  invite_token      VARCHAR(255) NOT NULL DEFAULT '',
  invite_kind       VARCHAR(20) NOT NULL DEFAULT 'email',
  firebase_uid      VARCHAR(128) NOT NULL DEFAULT '',
  pay_rate          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  weekly_limit      VARCHAR(20) NOT NULL DEFAULT '',
  currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_by_uid    VARCHAR(128) NOT NULL DEFAULT '',
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at       TIMESTAMPTZ,
  created_by        UUID,
  updated_by        UUID
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON invites (invite_token) WHERE invite_token <> ''`,
  `CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email)`,
  `CREATE INDEX IF NOT EXISTS idx_invites_status ON invites (status)`,
  `CREATE TABLE IF NOT EXISTS invite_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id     UUID NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by    UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_projects_invite ON invite_projects (invite_id)`,
  // ─── Pre-auth staging (migrated from Firestore) ──────────────────────────
  // Short-lived rows: created when an admin preprovisions a member before
  // they ever sign in, consumed by promotePendingMemberCore once they do.
  `CREATE TABLE IF NOT EXISTS pending_auth_members (
  firebase_uid      VARCHAR(128) PRIMARY KEY,
  email             VARCHAR(255) NOT NULL DEFAULT '',
  display_name      VARCHAR(250) NOT NULL DEFAULT '',
  phone_number      VARCHAR(40) NOT NULL DEFAULT '',
  role_id           UUID,
  role_name         VARCHAR(60) NOT NULL DEFAULT '',
  pay_rate          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_by_uid    VARCHAR(128) NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS pending_auth_projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid      VARCHAR(128) NOT NULL REFERENCES pending_auth_members(firebase_uid) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by        UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_pending_auth_projects_uid ON pending_auth_projects (firebase_uid)`,
  // ─── Member relationships / hierarchy graph (migrated from Firestore) ───
  // member_tree_cache (the derived, fast-read version of this graph) was
  // already Postgres-resident (member-data-postgres.service.js) - this is
  // the underlying edge list it's computed from, which was not.
  `CREATE TABLE IF NOT EXISTS member_relationships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_member_id      UUID NOT NULL,
  child_member_id       UUID NOT NULL,
  relationship_type     VARCHAR(20) NOT NULL DEFAULT 'admin_create',
  projects              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  UNIQUE (parent_member_id, child_member_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_member_rel_parent ON member_relationships (parent_member_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_member_rel_child ON member_relationships (child_member_id)`,
  `CREATE TABLE IF NOT EXISTS member_transfer_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         UUID NOT NULL,
  from_parent_id    UUID,
  to_parent_id      UUID NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_by      UUID,
  resolved_by       UUID,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_member_transfer_member ON member_transfer_requests (member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_member_transfer_status ON member_transfer_requests (status)`,
  // ─── Miscellaneous member-adjacent (migrated from Firestore) ────────────
  `CREATE TABLE IF NOT EXISTS members_field_data (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID,
  form_key      VARCHAR(60) NOT NULL DEFAULT '',
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_members_field_data_member ON members_field_data (member_id) WHERE member_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS access_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL DEFAULT '',
  name          VARCHAR(250) NOT NULL DEFAULT '',
  message       TEXT NOT NULL DEFAULT '',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
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
  `CREATE TABLE IF NOT EXISTS pay_rates (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id                   UUID          NOT NULL UNIQUE,
  type                        VARCHAR(30)   NOT NULL DEFAULT 'hourly',
  rate                        NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency                    VARCHAR(10)   NOT NULL DEFAULT 'USD',
  pay_period                  VARCHAR(30)   NOT NULL DEFAULT 'None',
  require_timesheet_approval  BOOLEAN       NOT NULL DEFAULT false,
  effective_date              DATE,
  status                      VARCHAR(20)   NOT NULL DEFAULT 'active',
  note                        TEXT          NOT NULL DEFAULT '',
  created_by                  VARCHAR(255),
  updated_by                  VARCHAR(255),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_pay_rates_member ON pay_rates (member_id)",
  `CREATE TABLE IF NOT EXISTS member_onboarding (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id               UUID,
  invite_id               UUID,
  created_account         BOOLEAN     NOT NULL DEFAULT false,
  created_account_at      TIMESTAMPTZ,
  downloaded_app          BOOLEAN     NOT NULL DEFAULT false,
  downloaded_app_at       TIMESTAMPTZ,
  tracked_time            BOOLEAN     NOT NULL DEFAULT false,
  tracked_time_at         TIMESTAMPTZ,
  last_reminder_sent_at   TIMESTAMPTZ,
  last_reminder_sent_by   VARCHAR(255) NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              VARCHAR(255),
  updated_by              VARCHAR(255),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_member_onboarding_member ON member_onboarding (member_id) WHERE member_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_member_onboarding_invite ON member_onboarding (invite_id) WHERE invite_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_member_onboarding_updated ON member_onboarding (updated_at DESC)",
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
  // ACT-4: the raw counters ActivityMeter::score() itself is built from, sent
  // alongside activity_level so the server can recompute or re-weight a score
  // later without an agent release.
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS keystroke_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS distinct_key_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS mouse_distance_px INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS injected_event_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS active_seconds_in_window INTEGER NOT NULL DEFAULT 0`,
  // AC-2: 64-bit dHash (16 hex chars) of the screenshot's on-screen content,
  // computed server-side at ingest. Lets the integrity sweep compare
  // consecutive captures for near-identical content (background-playback
  // fraud: activity reads high while the screen never actually changes)
  // without re-decoding stored images.
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS perceptual_hash VARCHAR(16)`,
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
  // ACT-4: same raw-signal columns as activity_screenshots. Merged app-log
  // rows (see insertActivityAppLog's extend-in-place path) accumulate these
  // alongside duration_seconds rather than overwriting, so a long-open
  // app/tab still carries its full session's signal, not just its first tick.
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS keystroke_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS distinct_key_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS mouse_distance_px INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS injected_event_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS active_seconds_in_window INTEGER NOT NULL DEFAULT 0`,
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
  // AC-2: output of the integrity sweep job (screenshot staleness / category
  // conflict correlation) - a durable, per-session record so a manager (and,
  // per AC-4, the employee themselves) can see and contest what was flagged,
  // unlike the ephemeral /monitor metrics OBS-2/OBS-3 use. One row per
  // session+flag_type: the sweep runs every few minutes and must not spam a
  // duplicate flag for a condition it already recorded.
  `CREATE TABLE IF NOT EXISTS activity_integrity_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID NOT NULL,
  session_id     VARCHAR(128) NOT NULL,
  flag_type      VARCHAR(32) NOT NULL CHECK (flag_type IN ('screenshot_staleness', 'category_conflict')),
  detail         TEXT NOT NULL DEFAULT '',
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  contested      BOOLEAN NOT NULL DEFAULT false,
  contested_at   TIMESTAMPTZ,
  contested_note TEXT,
  UNIQUE (session_id, flag_type)
)`,
  // AC-1: widened after 'injected_input' joined the sweep alongside AC-2's
  // original two flag types. Drop-then-recreate under the same (Postgres's
  // own default-generated) name is idempotent - a no-op once already
  // widened, safe to run on every boot, matching this file's convention.
  `ALTER TABLE activity_integrity_flags DROP CONSTRAINT IF EXISTS activity_integrity_flags_flag_type_check`,
  `ALTER TABLE activity_integrity_flags ADD CONSTRAINT activity_integrity_flags_flag_type_check CHECK (flag_type IN ('screenshot_staleness', 'category_conflict', 'injected_input'))`,
  `CREATE INDEX IF NOT EXISTS idx_act_integrity_member_detected ON activity_integrity_flags (member_id, detected_at DESC)`,
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
  // TC-7: guarantee at most one open session per member. Runs every boot -
  // idempotent by construction, matches zero rows once no duplicates exist -
  // so it stays safe to leave in this list permanently. MUST run before the
  // unique index below: that index creation fails outright (aborting this
  // whole DDL loop, i.e. a boot failure - see ensurePostgresLookupSchema's
  // single try/catch around the whole list) if any member still has more
  // than one open row when it runs. Keeps the most-recently-started session
  // per member and closes the rest, preserving whatever active/idle seconds
  // they last synced rather than discarding them.
  `UPDATE activity_sessions
     SET status = 'stopped', ended_at = now(), updated_at = now()
     WHERE ended_at IS NULL
       AND id NOT IN (
         SELECT DISTINCT ON (member_id) id
         FROM activity_sessions
         WHERE ended_at IS NULL
         ORDER BY member_id, started_at DESC
       )`,
  // TC-7: the actual guarantee. A concurrent "start"/"resume" that races past
  // the application-level findOpenSession() check (both requests see no open
  // session, both attempt to create one) is caught here instead of silently
  // opening a second session that then goes unsynced/unstoppable - see the
  // 23505 handling in routes.js around createPgSession.
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member
     ON activity_sessions (member_id) WHERE ended_at IS NULL`,
  // ─── CF-1: monitoring consent/config registry ───────────────────────────
  // Single-tenant deployment (no organizations/tenant table exists anywhere
  // in this schema - every other config table here, e.g. time_settings,
  // limits, employment, is a per-member singleton, not per-org). So this is
  // one global row per capability for the whole deployment, not the
  // org_id-scoped table the original design doc sketched for a hypothetical
  // multi-tenant product. Default-deny per capability (CF-0.1): a capability
  // with no row, or enabled = false, is never captured - the seeding step in
  // ensurePostgresLookupSchema (below the DDL loop) sets the initial value to
  // match whatever the pre-existing env-var gate already had it at, once,
  // ON CONFLICT DO NOTHING - so shipping this does not silently disable
  // screenshot capture that's already live. Every change after that goes
  // through setMonitoringCapability() and is admin-gated + audited.
  `CREATE TABLE IF NOT EXISTS monitoring_capabilities (
  capability            VARCHAR(40) PRIMARY KEY CHECK (capability IN (
                           'screenshots', 'app_tracking', 'url_capture',
                           'activity_metering', 'dns_logging', 'integrity_signals'
                        )),
  enabled               BOOLEAN NOT NULL DEFAULT false,
  jurisdiction_profile  VARCHAR(30) NOT NULL DEFAULT 'strictest' CHECK (jurisdiction_profile IN (
                           'eu_uk', 'us_one_party_consent', 'us_two_party_consent', 'strictest'
                        )),
  lawful_basis          VARCHAR(30) CHECK (lawful_basis IN ('legitimate_interest', 'consent', 'contract')),
  enabled_by            UUID,
  enabled_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  // Append-only by convention: application code (monitoring-policy.js) never
  // issues UPDATE/DELETE against this table, only INSERT - this is the
  // "immutable audit record" CF-0.1 requires (who enabled what, when, under
  // which lawful basis). Note this is an application-layer guarantee, not a
  // DB-role-enforced one (no REVOKE UPDATE/DELETE on the connection role) -
  // real tamper-resistance would need that at the infra layer.
  `CREATE TABLE IF NOT EXISTS monitoring_policy_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability       VARCHAR(40) NOT NULL,
  previous_enabled BOOLEAN,
  new_enabled      BOOLEAN NOT NULL,
  lawful_basis     VARCHAR(30),
  actor_member_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_monitoring_policy_audit_capability ON monitoring_policy_audit (capability, created_at DESC)`,
  // Per-member because disclosure/consent is inherently per-person (CF-0.2) -
  // a new hire needs their own first-run notice moment, unlike the global
  // capability toggles above. notice_version lets a policy-text change force
  // re-disclosure: bump it and every member's consented_at is stale again
  // until they re-acknowledge (enforced in monitoring-policy.js, not here).
  `CREATE TABLE IF NOT EXISTS member_monitoring_consent (
  member_id      UUID PRIMARY KEY,
  disclosed_at   TIMESTAMPTZ,
  consented_at   TIMESTAMPTZ,
  notice_version VARCHAR(40),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  // ─── CF-3: data minimization ─────────────────────────────────────────────
  // Global list (single-tenant, same reasoning as monitoring_capabilities):
  // an app or URL domain that must never be captured at all - not blurred,
  // not logged, not screenshotted - enforced at ingest in routes.js, the one
  // place every capture path (agent and web) already converges. Case-folded
  // uniqueness so "Chrome" and "chrome" aren't two different exclusions.
  `CREATE TABLE IF NOT EXISTS capture_exclusions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type   VARCHAR(10) NOT NULL CHECK (match_type IN ('app', 'domain')),
  pattern      VARCHAR(255) NOT NULL,
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_exclusions_unique ON capture_exclusions (match_type, lower(pattern))`,
  // Singleton row (id is always 1) - one deployment, one minimization
  // posture, same "no org concept exists" reasoning as everywhere else in
  // this phase. url_domain_only strips path/query at ingest (CF-0.3: "store
  // github.com, not the full path with query params that may carry personal
  // data"). screenshot_blur_default applies a blur pass in the existing
  // sharp() pipeline before a screenshot is ever written to disk/DB.
  `CREATE TABLE IF NOT EXISTS capture_minimization_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url_domain_only         BOOLEAN NOT NULL DEFAULT false,
  screenshot_blur_default BOOLEAN NOT NULL DEFAULT false,
  updated_by              UUID,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO capture_minimization_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  // ─── CF-5: retention limits & data-subject rights ───────────────────────
  // One row per monitoring data type, admin-tunable without a redeploy -
  // generalises the existing manual archive-screenshots.mjs script (which
  // only ever covered screenshots/app_logs/url_logs via CLI flags, defaults
  // explicitly called "illustrative, not a compliance recommendation") into
  // an enforced ceiling for all four member data stores, sessions included.
  // Screenshots get the shortest default (highest privacy risk, has images);
  // sessions get the longest (billing/audit relevance) - but every type has
  // a finite default. CF-0.5: "Indefinite retention... fails GDPR storage
  // limitation" - there is deliberately no "never delete" option here.
  `CREATE TABLE IF NOT EXISTS data_retention_settings (
  data_type      VARCHAR(20) PRIMARY KEY CHECK (data_type IN ('screenshots', 'app_logs', 'url_logs', 'sessions')),
  retention_days INT NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO data_retention_settings (data_type, retention_days) VALUES
     ('screenshots', 90), ('app_logs', 180), ('url_logs', 180), ('sessions', 730)
   ON CONFLICT (data_type) DO NOTHING`,
  // CF-0.5: "log every access" to raw screenshot data. Append-only, same
  // convention as monitoring_policy_audit - no update/delete function exists
  // for this table in the codebase.
  `CREATE TABLE IF NOT EXISTS screenshot_access_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_id    UUID NOT NULL,
  screenshot_owner UUID NOT NULL,
  reader_member_id UUID NOT NULL,
  accessed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_access_log_owner ON screenshot_access_log (screenshot_owner, accessed_at DESC)`,
  // ─── ACT-3: server-tunable activity scoring constants ───────────────────
  // Singleton row, same pattern as capture_minimization_settings (CF-3) -
  // "ACTIVITY_SATURATION_EVENTS = 120 is a hardcoded guess baked into the
  // binary... a data-entry role and a designer have very different '100%
  // looks like' baselines." Defaults match the values the Rust constants
  // used before this existed, so shipping this is a no-op until an admin
  // actually tunes it.
  `CREATE TABLE IF NOT EXISTS activity_scoring_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  saturation_events INT NOT NULL DEFAULT 120 CHECK (saturation_events > 0),
  window_ms         INT NOT NULL DEFAULT 60000 CHECK (window_ms > 0),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO activity_scoring_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  // ACT-3: widened beyond pure scoring to every agent constant the plan
  // names as "server-tunable" (screenshot cadence, idle thresholds) - one
  // singleton row and one Rust refresh cycle, not a second table with its
  // own fetch/cache machinery duplicating this one for no benefit. Defaults
  // match the Rust constants they override exactly, so this is a no-op
  // until an admin actually tunes something.
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS screenshot_min_delay_sec INT NOT NULL DEFAULT 90 CHECK (screenshot_min_delay_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS screenshot_max_delay_sec INT NOT NULL DEFAULT 210 CHECK (screenshot_max_delay_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_threshold_sec INT NOT NULL DEFAULT 60 CHECK (idle_threshold_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_warn_sec INT NOT NULL DEFAULT 300 CHECK (idle_warn_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_alert_sec INT NOT NULL DEFAULT 600 CHECK (idle_alert_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_stop_sec INT NOT NULL DEFAULT 900 CHECK (idle_stop_sec > 0)`,
  // ─── CLS-1: app/domain classification + unified display-name mapping ────
  // One row per (match_type, pattern) - single-tenant, same reasoning as
  // monitoring_capabilities/capture_exclusions (no org concept exists in this
  // schema, so there is one classification map for the deployment, not a
  // layered org-overrides-default lookup). is_global_default distinguishes a
  // shipped seed row from one an admin has touched, for UI/audit purposes
  // only - functionally there is always exactly one authoritative row per
  // pattern, an admin edit UPDATEs it in place rather than shadowing it.
  //
  // display_name doubles this table as the fix for F5/CQ-4: "window.rs's
  // BROWSER_EXES/overrides() and the frontend's display-names.ts are two
  // independent sources of truth that will drift" - confirmed drifted
  // already (Rust has devenv.exe/powershell.exe/cmd.exe/winword.exe/etc that
  // the frontend doesn't; the frontend has chrome.exe/msedge.exe/etc mapped
  // that Rust resolves a different way). One server-delivered table, both
  // consume it (MAC-3, once wired).
  //
  // role_override is JSONB keyed by role name -> category, e.g.
  // {"designer": "productive"} - "a designer on Behance is productive, a
  // data-entry clerk on Behance is distracting" without hardcoding a value
  // judgement per role into application code.
  `CREATE TABLE IF NOT EXISTS activity_categories (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type         VARCHAR(10) NOT NULL CHECK (match_type IN ('app', 'domain')),
  pattern            VARCHAR(255) NOT NULL,
  category           VARCHAR(20) NOT NULL DEFAULT 'unclassified' CHECK (category IN (
                        'productive', 'neutral', 'distracting', 'unclassified'
                     )),
  display_name       VARCHAR(120),
  role_override      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_global_default   BOOLEAN NOT NULL DEFAULT false,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_categories_unique ON activity_categories (match_type, lower(pattern))`,
  `CREATE INDEX IF NOT EXISTS idx_activity_categories_category ON activity_categories (category)`,
  // Global default map. ON CONFLICT DO NOTHING - an admin's prior edit to
  // any of these (e.g. reclassifying youtube.com as productive for a video-
  // editing team) is never overwritten by a later boot re-running this list.
  `INSERT INTO activity_categories (match_type, pattern, category, display_name, is_global_default) VALUES
     ('app', 'code.exe', 'productive', 'VS Code', true),
     ('app', 'cursor.exe', 'productive', 'Cursor', true),
     ('app', 'devenv.exe', 'productive', 'Visual Studio', true),
     ('app', 'pycharm64.exe', 'productive', 'PyCharm', true),
     ('app', 'idea64.exe', 'productive', 'IntelliJ IDEA', true),
     ('app', 'winword.exe', 'productive', 'Microsoft Word', true),
     ('app', 'excel.exe', 'productive', 'Microsoft Excel', true),
     ('app', 'powerpnt.exe', 'productive', 'PowerPoint', true),
     ('app', 'outlook.exe', 'productive', 'Outlook', true),
     ('app', 'windowsterminal.exe', 'productive', 'Windows Terminal', true),
     ('app', 'wt.exe', 'productive', 'Windows Terminal', true),
     ('app', 'powershell.exe', 'productive', 'PowerShell', true),
     ('app', 'cmd.exe', 'productive', 'Command Prompt', true),
     ('app', 'python.exe', 'productive', 'Python', true),
     ('app', 'pythonw.exe', 'productive', 'Python', true),
     ('app', 'explorer.exe', 'neutral', 'File Explorer', true),
     ('app', 'slack.exe', 'neutral', 'Slack', true),
     ('app', 'discord.exe', 'neutral', 'Discord', true),
     ('app', 'teams.exe', 'neutral', 'Microsoft Teams', true),
     ('app', 'zoom.exe', 'neutral', 'Zoom', true),
     ('app', 'spotify.exe', 'distracting', 'Spotify', true),
     ('app', 'steam.exe', 'distracting', 'Steam', true),
     ('app', 'discord_ptb.exe', 'distracting', 'Discord PTB', true),
     ('app', 'chrome.exe', 'unclassified', 'Google Chrome', true),
     ('app', 'msedge.exe', 'unclassified', 'Microsoft Edge', true),
     ('app', 'firefox.exe', 'unclassified', 'Mozilla Firefox', true),
     ('app', 'brave.exe', 'unclassified', 'Brave', true),
     ('app', 'opera.exe', 'unclassified', 'Opera', true),
     ('app', 'operagx.exe', 'unclassified', 'Opera GX', true),
     ('app', 'vivaldi.exe', 'unclassified', 'Vivaldi', true),
     ('app', 'chromium.exe', 'unclassified', 'Chromium', true),
     ('app', 'iexplore.exe', 'unclassified', 'Internet Explorer', true),
     ('app', 'zen.exe', 'unclassified', 'Zen', true),
     ('app', 'waterfox.exe', 'unclassified', 'Waterfox', true),
     -- MAC-3: macOS has no .exe suffix - xcap::Window::app_name() reports
     -- the bare display name directly ("Google Chrome", not "chrome.exe").
     -- Same logical apps, a second pattern form so a lookup keyed by
     -- whatever the platform naturally reports still hits one canonical
     -- category/display_name pair - this is what "one server-delivered
     -- list, not two independently-drifting ones" actually requires once a
     -- second platform is in play.
     ('app', 'Visual Studio Code', 'productive', 'VS Code', true),
     ('app', 'Cursor', 'productive', 'Cursor', true),
     ('app', 'Xcode', 'productive', 'Xcode', true),
     ('app', 'Terminal', 'productive', 'Terminal', true),
     ('app', 'iTerm2', 'productive', 'iTerm', true),
     ('app', 'Microsoft Word', 'productive', 'Microsoft Word', true),
     ('app', 'Microsoft Excel', 'productive', 'Microsoft Excel', true),
     ('app', 'Microsoft PowerPoint', 'productive', 'PowerPoint', true),
     ('app', 'Finder', 'neutral', 'Finder', true),
     ('app', 'Slack', 'neutral', 'Slack', true),
     ('app', 'Discord', 'neutral', 'Discord', true),
     ('app', 'Microsoft Teams', 'neutral', 'Microsoft Teams', true),
     ('app', 'zoom.us', 'neutral', 'Zoom', true),
     ('app', 'Spotify', 'distracting', 'Spotify', true),
     ('app', 'Steam', 'distracting', 'Steam', true),
     ('app', 'Safari', 'unclassified', 'Safari', true),
     ('app', 'Google Chrome', 'unclassified', 'Google Chrome', true),
     ('app', 'Microsoft Edge', 'unclassified', 'Microsoft Edge', true),
     ('app', 'Firefox', 'unclassified', 'Mozilla Firefox', true),
     ('app', 'Brave Browser', 'unclassified', 'Brave', true),
     ('app', 'Opera', 'unclassified', 'Opera', true),
     ('app', 'Vivaldi', 'unclassified', 'Vivaldi', true),
     ('app', 'Arc', 'unclassified', 'Arc', true),
     ('domain', 'github.com', 'productive', NULL, true),
     ('domain', 'gitlab.com', 'productive', NULL, true),
     ('domain', 'stackoverflow.com', 'productive', NULL, true),
     ('domain', 'docs.google.com', 'productive', NULL, true),
     ('domain', 'notion.so', 'productive', NULL, true),
     ('domain', 'atlassian.net', 'productive', NULL, true),
     ('domain', 'mail.google.com', 'neutral', NULL, true),
     ('domain', 'outlook.office.com', 'neutral', NULL, true),
     ('domain', 'slack.com', 'neutral', NULL, true),
     ('domain', 'calendar.google.com', 'neutral', NULL, true),
     ('domain', 'youtube.com', 'distracting', NULL, true),
     ('domain', 'netflix.com', 'distracting', NULL, true),
     ('domain', 'twitch.tv', 'distracting', NULL, true),
     ('domain', 'facebook.com', 'distracting', NULL, true),
     ('domain', 'instagram.com', 'distracting', NULL, true),
     ('domain', 'twitter.com', 'distracting', NULL, true),
     ('domain', 'x.com', 'distracting', NULL, true),
     ('domain', 'tiktok.com', 'distracting', NULL, true),
     ('domain', 'reddit.com', 'distracting', NULL, true)
   ON CONFLICT (match_type, lower(pattern)) DO NOTHING`,
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
  idle_time_seconds       INTEGER NOT NULL DEFAULT 450,
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
  // Pre-existing databases created before per-project idle time existed.
  // ADD COLUMN ... DEFAULT on Postgres backfills existing rows to the
  // default for free (metadata-only since PG11) - every pre-existing project
  // reads 450s/7.5min same as a newly created one, no separate UPDATE needed.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS idle_time_seconds INTEGER NOT NULL DEFAULT 450`,
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
  // CF-6: "device ownership (company/BYOD) is recorded and auditable."
  // Added to the existing per-device row rather than a new table - this is
  // already the one row per linked machine. Defaults to 'unspecified' (not
  // 'company') so a device that's never been classified doesn't silently
  // read as company-owned.
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership VARCHAR(20) NOT NULL DEFAULT 'unspecified' CHECK (ownership IN ('company', 'personal', 'unspecified'))`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership_set_by UUID`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership_set_at TIMESTAMPTZ`,
  // AC-3: reported once at link/reauth time by the agent itself (CPUID
  // hypervisor bit, vendor string, VM MAC OUI, driver artifacts on Windows;
  // sysctl kern.hv_vmm_present on macOS). Deliberately device-level, not
  // folded into a per-session score - activity_sessions carries no device_id
  // to correlate against, and the plan is explicit that this signal "has
  // real false positives" and must stay a reviewable flag, never an
  // automatic verdict, so it is surfaced next to device ownership for a
  // manager to weigh in context rather than subtracted from anything.
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_detected BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_signals TEXT`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_detected_at TIMESTAMPTZ`,
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
  //
  // Self-healing: an earlier deploy of this exact migration created
  // fk_tmp_task WITHOUT "ON DELETE CASCADE" (Postgres defaults to NO ACTION),
  // and the original "IF NOT EXISTS (name)" guard only ever checked whether
  // *a* constraint with that name existed - never whether it actually had
  // cascade behavior - so it silently never got fixed. Every task delete has
  // been failing with "violates foreign key constraint fk_tmp_task" since.
  // confdeltype 'c' = CASCADE; anything else means it needs replacing.
  `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tmp_task' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE task_member_progress DROP CONSTRAINT fk_tmp_task;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tmp_task') THEN
    ALTER TABLE task_member_progress ADD CONSTRAINT fk_tmp_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;
END $$`,
  // Same class of bug as fk_tmp_task above, on the project side this time:
  // tasks.project_id, task_assignments.project_id, and
  // task_member_progress.project_id were all declared as inline
  // `REFERENCES projects(id)` with no ON DELETE clause, which Postgres
  // defaults to NO ACTION - so DELETE FROM projects fails outright for any
  // project that has ever had a task ("violates foreign key constraint...
  // on table tasks"), every time. Self-healing on every boot: for each
  // table, find any FK to projects that isn't already CASCADE, drop it, and
  // recreate it correctly. Table-scoped by conrelid rather than a specific
  // constraint name, since these were never given one - Postgres auto-named
  // them, and the auto-generated name isn't worth depending on.
  `DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
  WHERE conrelid = 'tasks'::regclass AND confrelid = 'projects'::regclass
    AND contype = 'f' AND confdeltype != 'c'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', con_name);
    ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$`,
  `DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
  WHERE conrelid = 'task_assignments'::regclass AND confrelid = 'projects'::regclass
    AND contype = 'f' AND confdeltype != 'c'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE task_assignments DROP CONSTRAINT %I', con_name);
    ALTER TABLE task_assignments ADD CONSTRAINT task_assignments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$`,
  `DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
  WHERE conrelid = 'task_member_progress'::regclass AND confrelid = 'projects'::regclass
    AND contype = 'f' AND confdeltype != 'c'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE task_member_progress DROP CONSTRAINT %I', con_name);
    ALTER TABLE task_member_progress ADD CONSTRAINT task_member_progress_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
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
  // Recurring "Schedule" delivery for reports (currently just time-and-activity) -
  // one row per saved schedule, a timer-based runner (report-schedule-runner.js)
  // polls this on the same interval-timer pattern team-weekly-report.service.js
  // already uses, no job-queue dependency needed for one feature.
  `CREATE TABLE IF NOT EXISTS report_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type     VARCHAR(64) NOT NULL DEFAULT 'time-and-activity',
  name            TEXT,
  member_id       UUID,
  emails          TEXT[] NOT NULL,
  subject         TEXT,
  message         TEXT,
  file_type       VARCHAR(8) NOT NULL DEFAULT 'pdf' CHECK (file_type IN ('csv', 'pdf')),
  date_range_kind VARCHAR(32) NOT NULL DEFAULT 'The last 7 days',
  frequency       VARCHAR(16) NOT NULL DEFAULT 'Weekly' CHECK (frequency IN ('Daily', 'Weekly', 'Bi-weekly', 'Monthly')),
  delivery_time   TIME NOT NULL DEFAULT '08:30',
  created_by      UUID NOT NULL,
  last_sent_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules (frequency, last_sent_at)`,
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

    // CF-1: seed the 'screenshots' capability's initial enabled state from
    // the pre-existing env-var gate (isActivityScreenshotsEnabled), exactly
    // once, so shipping the new registry does not silently disable capture
    // that's already live in production. ON CONFLICT DO NOTHING - any
    // subsequent admin change via setMonitoringCapability() is permanent and
    // this never overwrites it on a later boot. Every other capability seeds
    // as its table default (enabled = false) via ordinary INSERT-if-absent,
    // matching CF-0.1's true default-deny for anything not already live.
    await client.query(
      `INSERT INTO monitoring_capabilities (capability, enabled)
       VALUES ('screenshots', $1)
       ON CONFLICT (capability) DO NOTHING`,
      [isActivityScreenshotsEnabled()],
    );
    for (const capability of ["app_tracking", "url_capture", "activity_metering", "dns_logging", "integrity_signals"]) {
      await client.query(
        `INSERT INTO monitoring_capabilities (capability) VALUES ($1) ON CONFLICT (capability) DO NOTHING`,
        [capability],
      );
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
