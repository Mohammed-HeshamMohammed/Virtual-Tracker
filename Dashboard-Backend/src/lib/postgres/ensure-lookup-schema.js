import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import { markPostgresLookupReady, resetPostgresLookupReadyCache } from "./lookup-availability.js";
import { markPostgresMemberDataReady, resetPostgresMemberDataReadyCache } from "./member-data-availability.js";
import { isActivityScreenshotsEnabled } from "../../config/activity.js";

function cascadeOnDelete(table, column, parentTable, { nullable = true } = {}) {
  const constraintName = `${table}_${column}_fkey`;
  return [
    `DELETE FROM ${table} WHERE ${nullable ? `${column} IS NOT NULL AND ` : ""}${column} NOT IN (SELECT id FROM ${parentTable})`,
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}') THEN
    ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${column}) REFERENCES ${parentTable}(id) ON DELETE CASCADE;
  END IF;
END $$`,
  ];
}

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
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(60) NOT NULL UNIQUE,
  description     TEXT,
  hierarchy_level INTEGER     NOT NULL DEFAULT 10,
  is_management   BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      VARCHAR(255),
  updated_by      VARCHAR(255),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "ALTER TABLE roles ADD COLUMN IF NOT EXISTS hierarchy_level INTEGER NOT NULL DEFAULT 10",
  "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_management BOOLEAN NOT NULL DEFAULT false",
  "CREATE INDEX IF NOT EXISTS idx_roles_name ON roles (name)",
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
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS security_stamp UUID DEFAULT gen_random_uuid()",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS migrated_from_auth BOOLEAN NOT NULL DEFAULT false",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS migrated_by UUID",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS desktop_agent_linked_at TIMESTAMPTZ",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS web_capture_linked_at TIMESTAMPTZ",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS agent_source VARCHAR(20)",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS privileged_role_owner_granted BOOLEAN",
  "ALTER TABLE members ADD COLUMN IF NOT EXISTS privileged_role_owner_granted_at TIMESTAMPTZ",
  "UPDATE roles SET hierarchy_level = 100, is_management = true WHERE REGEXP_REPLACE(LOWER(name), '\\s+', '', 'g') IN ('superadmin', 'owner')",
  "UPDATE roles SET hierarchy_level = 80,  is_management = true WHERE REGEXP_REPLACE(LOWER(name), '\\s+', '', 'g') = 'admin'",
  "UPDATE roles SET hierarchy_level = 50,  is_management = true WHERE REGEXP_REPLACE(LOWER(name), '\\s+', '', 'g') IN ('supermanager', 'supermanger', 'manager')",
  "UPDATE roles SET hierarchy_level = 20,  is_management = false WHERE REGEXP_REPLACE(LOWER(name), '\\s+', '', 'g') IN ('employee', 'user')",
  "UPDATE roles SET hierarchy_level = 10,  is_management = false WHERE REGEXP_REPLACE(LOWER(name), '\\s+', '', 'g') = 'client'",
  `CREATE TABLE IF NOT EXISTS role_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  VARCHAR(100) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_key)
)`,
  "CREATE INDEX IF NOT EXISTS idx_role_perms_role ON role_permissions (role_id)",
  `CREATE OR REPLACE VIEW v_members_enriched AS
SELECT 
  m.id,
  m.firebase_uid,
  m.first_name,
  m.last_name,
  m.display_name,
  m.work_email,
  m.personal_email,
  m.status,
  m.avatar_url,
  m.avatar_color,
  m.date_added,
  m.role_id,
  m.security_stamp,
  COALESCE(r.name, 'Viewer') AS role_name,
  COALESCE(r.hierarchy_level, 10) AS hierarchy_level,
  COALESCE(r.is_management, false) AS is_management,
  COALESCE(p.rate, 0) AS pay_rate,
  COALESCE(p.pay_period, 'None') AS pay_period,
  l.weekly AS weekly_limit,
  l.daily AS daily_limit,
  
  COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'is_lead', tm.is_lead))
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.member_id = m.id
  ), '[]'::json) AS teams,

  COALESCE((
    SELECT json_agg(json_build_object('id', pr.id, 'name', pr.name))
    FROM project_members pm
    JOIN projects pr ON pr.id = pm.project_id
    WHERE pm.member_id = m.id
  ), '[]'::json) AS projects

FROM members m
LEFT JOIN roles r ON r.id = m.role_id
LEFT JOIN pay_rates p ON p.member_id = m.id
LEFT JOIN limits l ON l.member_id = m.id`,
  `CREATE OR REPLACE VIEW v_team_rosters AS
SELECT 
  tm.id,
  tm.team_id,
  tm.member_id,
  tm.is_lead,
  tm.joined_at,
  m.display_name AS member_name,
  m.avatar_url AS member_avatar,
  m.work_email AS member_email,
  m.avatar_color AS member_color,
  COALESCE(r.name, 'Viewer') AS member_role
FROM team_members tm
JOIN members m ON m.id = tm.member_id
LEFT JOIN roles r ON r.id = m.role_id`,
  `CREATE OR REPLACE FUNCTION fn_get_subordinate_member_ids(viewer_id UUID)
RETURNS TABLE (member_id UUID, depth INT) AS $$
WITH RECURSIVE org_tree AS (
  SELECT child_member_id AS member_id, 1 AS depth
  FROM member_relationships
  WHERE parent_member_id = viewer_id

  UNION ALL

  SELECT mr.child_member_id, ot.depth + 1
  FROM member_relationships mr
  INNER JOIN org_tree ot ON mr.parent_member_id = ot.member_id
)
SELECT DISTINCT member_id, depth FROM org_tree;
$$ LANGUAGE sql STABLE`,
  `CREATE OR REPLACE FUNCTION fn_can_actor_manage_target(actor_id UUID, target_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_actor_level INT;
  v_actor_is_mgmt BOOLEAN;
  v_target_level INT;
  v_is_subordinate BOOLEAN;
BEGIN
  IF actor_id = target_id THEN RETURN TRUE; END IF;

  SELECT r.hierarchy_level, r.is_management 
  INTO v_actor_level, v_actor_is_mgmt
  FROM members m JOIN roles r ON r.id = m.role_id WHERE m.id = actor_id;

  IF COALESCE(v_actor_level, 0) >= 80 THEN RETURN TRUE; END IF;
  IF NOT COALESCE(v_actor_is_mgmt, false) THEN RETURN FALSE; END IF;

  SELECT r.hierarchy_level INTO v_target_level 
  FROM members m JOIN roles r ON r.id = m.role_id WHERE m.id = target_id;

  IF COALESCE(v_actor_level, 0) <= COALESCE(v_target_level, 0) THEN RETURN FALSE; END IF;

  SELECT EXISTS (
    SELECT 1 FROM fn_get_subordinate_member_ids(actor_id) WHERE member_id = target_id
  ) INTO v_is_subordinate;

  RETURN v_is_subordinate;
END;
$$ LANGUAGE plpgsql STABLE`,
  `CREATE OR REPLACE FUNCTION fn_member_has_permission(p_member_id UUID, p_perm_key VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_perm BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM members m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.id = p_member_id 
      AND (rp.permission_key = p_perm_key OR rp.permission_key = '*')
  ) INTO v_has_perm;

  RETURN v_has_perm;
END;
$$ LANGUAGE plpgsql STABLE`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   VARCHAR(60) NOT NULL,
  record_id    UUID NOT NULL,
  action       VARCHAR(20) NOT NULL,
  old_data     JSONB,
  new_data     JSONB,
  performed_by UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_logs (table_name, record_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC)",
  `CREATE OR REPLACE FUNCTION fn_audit_log_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER`,
  `DROP TRIGGER IF EXISTS trg_audit_members ON members`,
  `CREATE TRIGGER trg_audit_members AFTER INSERT OR UPDATE OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION fn_audit_log_trigger()`,
  `DROP TRIGGER IF EXISTS trg_audit_roles ON roles`,
  `CREATE TRIGGER trg_audit_roles AFTER INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION fn_audit_log_trigger()`,
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
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tp_team') THEN
    ALTER TABLE team_projects ADD CONSTRAINT fk_tp_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$`,
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
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_member_id   UUID NOT NULL,
  target_member_id      UUID,
  target_email          VARCHAR(255) NOT NULL DEFAULT '',
  token                 VARCHAR(128),
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at            TIMESTAMPTZ,
  responded_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS requester_member_id UUID`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS target_member_id UUID`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS target_email VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS token VARCHAR(128)`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ`,
  `ALTER TABLE member_transfer_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS member_id`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS from_parent_id`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS to_parent_id`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS requested_by`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS resolved_by`,
  `ALTER TABLE member_transfer_requests DROP COLUMN IF EXISTS resolved_at`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_member_transfer_token ON member_transfer_requests (token) WHERE token IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_member_transfer_target ON member_transfer_requests (target_member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_member_transfer_status ON member_transfer_requests (status)`,
  `CREATE TABLE IF NOT EXISTS deactivation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL,
  firebase_uid    VARCHAR(128) NOT NULL DEFAULT '',
  member_email    VARCHAR(255) NOT NULL DEFAULT '',
  member_name     VARCHAR(255) NOT NULL DEFAULT '',
  role_name       VARCHAR(60) NOT NULL DEFAULT '',
  governance      VARCHAR(40) NOT NULL DEFAULT '',
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  source          VARCHAR(40) NOT NULL DEFAULT '',
  resolved_by     UUID,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_deactivation_status ON deactivation_requests (status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_deactivation_pending_member
     ON deactivation_requests (member_id) WHERE status = 'pending'`,
  `CREATE TABLE IF NOT EXISTS members_field_data (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID,
  form_key      VARCHAR(60) NOT NULL DEFAULT '',
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_members_field_data_member ON members_field_data (member_id) WHERE member_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_members_field_data_member_form
     ON members_field_data (member_id, form_key) WHERE member_id IS NOT NULL`,
  `ALTER TABLE members_field_data ADD COLUMN IF NOT EXISTS modified_by UUID`,
  `CREATE TABLE IF NOT EXISTS access_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL DEFAULT '',
  name          VARCHAR(250) NOT NULL DEFAULT '',
  phone         VARCHAR(40) NOT NULL DEFAULT '',
  message       TEXT NOT NULL DEFAULT '',
  source        VARCHAR(60) NOT NULL DEFAULT '',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NOT NULL DEFAULT ''`,
  `ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS source VARCHAR(60) NOT NULL DEFAULT ''`,
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
  amount          NUMERIC(12,2),
  currency        VARCHAR(10),
  project_breakdown JSONB,
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
  "ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)",
  "ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS currency VARCHAR(10)",
  "ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS project_breakdown JSONB",
  `DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries`,
  `CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_timesheets_updated_at ON timesheets`,
  `CREATE TRIGGER trg_timesheets_updated_at
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  "ALTER TABLE roles ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE roles ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE lookup_tables ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE lookup_tables ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE time_entries ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text",
  "ALTER TABLE time_entries ALTER COLUMN updated_by TYPE VARCHAR(255) USING updated_by::text",
  "ALTER TABLE timesheets ALTER COLUMN approved_by TYPE VARCHAR(255) USING approved_by::text",
  `DO $$
DECLARE
  v_legacy_id UUID;
  v_l0_id UUID;
BEGIN
  SELECT id INTO v_legacy_id FROM roles WHERE LOWER(name) = 'employee' LIMIT 1;
  SELECT id INTO v_l0_id FROM roles WHERE LOWER(name) = 'employee l0' LIMIT 1;
  IF v_legacy_id IS NOT NULL AND v_l0_id IS NOT NULL AND v_legacy_id <> v_l0_id THEN
    UPDATE members SET role_id = v_l0_id WHERE role_id = v_legacy_id;
    UPDATE invites SET role_id = v_l0_id WHERE role_id = v_legacy_id;
    UPDATE pending_auth_members SET role_id = v_l0_id WHERE role_id = v_legacy_id;
    DELETE FROM roles WHERE id = v_legacy_id;
  END IF;
END $$`,
  "UPDATE roles SET name = 'Team Lead' WHERE name = 'Employee L2'",
  "UPDATE roles SET name = 'Employee' WHERE name = 'Employee L1'",
  "UPDATE roles SET name = 'Intern' WHERE name = 'Employee L0'",
  "UPDATE pending_auth_members SET role_name = 'Team Lead' WHERE role_name = 'Employee L2'",
  "UPDATE pending_auth_members SET role_name = 'Employee' WHERE role_name = 'Employee L1'",
  "UPDATE pending_auth_members SET role_name = 'Intern' WHERE role_name = 'Employee L0'",
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
  makeup_days                     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  updated_by                      VARCHAR(255),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  "ALTER TABLE time_settings ADD COLUMN IF NOT EXISTS makeup_days JSONB NOT NULL DEFAULT '[]'::jsonb",
  "CREATE INDEX IF NOT EXISTS idx_time_settings_member ON time_settings (member_id)",
  `CREATE TABLE IF NOT EXISTS member_makeup_days (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID         NOT NULL,
  missed_date   DATE         NOT NULL,
  makeup_date   DATE         NOT NULL,
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (member_id, missed_date, makeup_date)
)`,
  "CREATE INDEX IF NOT EXISTS idx_member_makeup_days_member ON member_makeup_days (member_id)",
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
  `CREATE TABLE IF NOT EXISTS pay_rate_history (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id              UUID          NOT NULL,
  type                   VARCHAR(30)   NOT NULL DEFAULT 'hourly',
  rate                   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency               VARCHAR(10)   NOT NULL DEFAULT 'USD',
  pay_period             VARCHAR(30)   NOT NULL DEFAULT 'None',
  effective_date         DATE,
  status                 VARCHAR(20)   NOT NULL DEFAULT 'active',
  note                   TEXT          NOT NULL DEFAULT '',
  previous_rate          NUMERIC(10, 2),
  previous_currency      VARCHAR(10),
  previous_pay_period    VARCHAR(30),
  changed_by_member_id   UUID,
  changed_by_name        VARCHAR(255)  NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_pay_rate_history_member ON pay_rate_history (member_id, created_at DESC)",
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
  `ALTER TABLE activity_screenshots ALTER COLUMN screenshot_url DROP NOT NULL`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS image_data BYTEA`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS keystroke_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS distinct_key_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS mouse_distance_px INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS injected_event_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS active_seconds_in_window INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS perceptual_hash VARCHAR(16)`,

  // activity_level is evidence, produced from the raw counters stored beside
  // it. A manager can correct it, but the original must survive that: an edit
  // that overwrites in place destroys the audit trail of a time-tracking
  // product. Written only on the FIRST edit (COALESCE), so re-editing never
  // loses what the agent actually measured.
  //
  // The integrity sweep reads COALESCE(activity_level_original, activity_level)
  // for exactly this reason - anti-cheat is judged on measurements, never on
  // a correction. See integrity-postgres.service.js.
  // Site open when the capture was taken, sent by the agent. Lets the feed
  // categorise a browser screenshot by what was on screen rather than
  // inferring it from a nearby URL log. Nullable: older agents send nothing,
  // and the resolver's inference remains the fallback.
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS url TEXT`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS domain VARCHAR(255)`,

  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_original INTEGER`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edited_by UUID`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edited_at TIMESTAMPTZ`,
  `ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edit_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_member_captured ON activity_screenshots (member_id, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_session ON activity_screenshots (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_act_ss_captured ON activity_screenshots (captured_at DESC)`,
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
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS keystroke_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS distinct_key_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS mouse_distance_px INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS injected_event_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE activity_app_logs ADD COLUMN IF NOT EXISTS active_seconds_in_window INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_act_app_member_started ON activity_app_logs (member_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_act_app_started ON activity_app_logs (started_at DESC)`,
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
  `ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))`,
  `ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS project_id UUID`,
  `ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS stop_note TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_project ON activity_sessions (project_id) WHERE project_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member ON activity_sessions (member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member_open ON activity_sessions (member_id) WHERE ended_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_act_sess_member_started ON activity_sessions (member_id, started_at DESC)`,
  `UPDATE activity_sessions
     SET status = 'stopped', ended_at = now(), updated_at = now()
     WHERE ended_at IS NULL
       AND id NOT IN (
         SELECT DISTINCT ON (member_id) id
         FROM activity_sessions
         WHERE ended_at IS NULL
         ORDER BY member_id, started_at DESC
       )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member
     ON activity_sessions (member_id) WHERE ended_at IS NULL`,
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
  `CREATE TABLE IF NOT EXISTS member_monitoring_consent (
  member_id      UUID PRIMARY KEY,
  disclosed_at   TIMESTAMPTZ,
  consented_at   TIMESTAMPTZ,
  notice_version VARCHAR(40),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS capture_exclusions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type   VARCHAR(10) NOT NULL CHECK (match_type IN ('app', 'domain')),
  pattern      VARCHAR(255) NOT NULL,
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_exclusions_unique ON capture_exclusions (match_type, lower(pattern))`,
  `CREATE TABLE IF NOT EXISTS capture_minimization_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url_domain_only         BOOLEAN NOT NULL DEFAULT false,
  screenshot_blur_default BOOLEAN NOT NULL DEFAULT false,
  updated_by              UUID,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO capture_minimization_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS data_retention_settings (
  data_type      VARCHAR(20) PRIMARY KEY CHECK (data_type IN ('screenshots', 'app_logs', 'url_logs', 'sessions')),
  retention_days INT NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO data_retention_settings (data_type, retention_days) VALUES
     ('screenshots', 90), ('app_logs', 180), ('url_logs', 180), ('sessions', 730)
   ON CONFLICT (data_type) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS screenshot_access_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_id    UUID NOT NULL,
  screenshot_owner UUID NOT NULL,
  reader_member_id UUID NOT NULL,
  accessed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_access_log_owner ON screenshot_access_log (screenshot_owner, accessed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_scoring_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  saturation_events INT NOT NULL DEFAULT 120 CHECK (saturation_events > 0),
  window_ms         INT NOT NULL DEFAULT 60000 CHECK (window_ms > 0),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `INSERT INTO activity_scoring_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS screenshot_min_delay_sec INT NOT NULL DEFAULT 90 CHECK (screenshot_min_delay_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS screenshot_max_delay_sec INT NOT NULL DEFAULT 210 CHECK (screenshot_max_delay_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_threshold_sec INT NOT NULL DEFAULT 60 CHECK (idle_threshold_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_warn_sec INT NOT NULL DEFAULT 300 CHECK (idle_warn_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_alert_sec INT NOT NULL DEFAULT 600 CHECK (idle_alert_sec > 0)`,
  `ALTER TABLE activity_scoring_settings ADD COLUMN IF NOT EXISTS idle_stop_sec INT NOT NULL DEFAULT 900 CHECK (idle_stop_sec > 0)`,
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
  type                    VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (type IN ('normal', 'calling', 'retainer', 'fixed_price', 'internal', 'support', 'management')),
  end_date                DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID,
  updated_by              UUID,
  archived_by             UUID,
  archived_at             TIMESTAMPTZ
)`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'normal'`,
  `ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_type_check`,
  `ALTER TABLE projects ADD CONSTRAINT projects_type_check CHECK (type IN ('normal', 'calling', 'retainer', 'fixed_price', 'internal', 'support', 'management'))`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS idle_time_seconds INTEGER NOT NULL DEFAULT 450`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_task_to_track BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS restrict_task_creation BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_stop_note BOOLEAN NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id)`,
  `CREATE TABLE IF NOT EXISTS invite_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id     UUID NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by    UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_projects_invite ON invite_projects (invite_id)`,
  `CREATE TABLE IF NOT EXISTS pending_auth_projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid      VARCHAR(128) NOT NULL REFERENCES pending_auth_members(firebase_uid) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by        UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_pending_auth_projects_uid ON pending_auth_projects (firebase_uid)`,
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
  `ALTER TABLE project_members ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual'`,
  `CREATE TABLE IF NOT EXISTS project_subprojects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  child_project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by          UUID,
  UNIQUE (parent_project_id, child_project_id),
  -- A project cannot be its own sub-project. Deeper cycles are prevented in
  -- application code (only non-management projects may be children, so a
  -- chain of management projects cannot form).
  CHECK (parent_project_id <> child_project_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_psp_parent ON project_subprojects (parent_project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_psp_child ON project_subprojects (child_project_id)`,
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
  end_date                    DATE,
  include_non_billable_time   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_project ON project_budgets (project_id)`,
  `ALTER TABLE project_budgets ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'per_project'`,
  `ALTER TABLE project_budgets ADD COLUMN IF NOT EXISTS end_date DATE`,
  `CREATE TABLE IF NOT EXISTS project_budget_notify_state (
  project_id            UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  notified_period_key   VARCHAR(40),
  notify_at_pct         NUMERIC(5, 2),
  last_usage_pct        NUMERIC(6, 2),
  last_sent_at          TIMESTAMPTZ
)`,
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
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_can_manage BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_can_track BOOLEAN NOT NULL DEFAULT false`,
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
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership VARCHAR(20) NOT NULL DEFAULT 'unspecified' CHECK (ownership IN ('company', 'personal', 'unspecified'))`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership_set_by UUID`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS ownership_set_at TIMESTAMPTZ`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_detected BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_signals TEXT`,
  `ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS vm_detected_at TIMESTAMPTZ`,
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
  `ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS total_assignees INT,
    ADD COLUMN IF NOT EXISTS started_assignees INT,
    ADD COLUMN IF NOT EXISTS not_started_assignees INT,
    ADD COLUMN IF NOT EXISTS participation_percent INT,
    ADD COLUMN IF NOT EXISTS all_assignees_started BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rolling_hour_cap BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS shared_task_budget BOOLEAN NOT NULL DEFAULT false`,
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
  `CREATE TABLE IF NOT EXISTS task_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_by    UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id)`,
  `CREATE TABLE IF NOT EXISTS task_subtasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title         VARCHAR(500) NOT NULL DEFAULT '',
  completed     BOOLEAN NOT NULL DEFAULT false,
  order_index   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_by    UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON task_subtasks (task_id)`,
  `CREATE TABLE IF NOT EXISTS task_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_url      TEXT NOT NULL DEFAULT '',
  file_name     VARCHAR(500) NOT NULL DEFAULT '',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by   UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments (task_id)`,
  `CREATE TABLE IF NOT EXISTS task_hours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  hours_spent   NUMERIC(8, 2) NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_by    UUID
)`,
  `CREATE INDEX IF NOT EXISTS idx_task_hours_task ON task_hours (task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_task_hours_user ON task_hours (user_id)`,
  `ALTER TABLE task_member_progress
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id),
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS review_notes TEXT`,
  `ALTER TABLE task_member_progress ADD COLUMN IF NOT EXISTS rolling_session_started_at TIMESTAMPTZ`,
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
  "DROP INDEX IF EXISTS idx_roles_name",
  "DROP INDEX IF EXISTS idx_time_settings_member",
  "DROP INDEX IF EXISTS idx_employment_member",
  "CREATE INDEX IF NOT EXISTS idx_act_sess_task ON activity_sessions (task_id) WHERE task_id IS NOT NULL",
  "DROP TYPE IF EXISTS task_status",
  "ALTER TABLE activity_screenshots DROP COLUMN IF EXISTS has_image",
  `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuidv7') THEN
    ALTER TABLE task_assignments ALTER COLUMN id SET DEFAULT uuidv7();
    ALTER TABLE task_member_progress ALTER COLUMN id SET DEFAULT uuidv7();
  END IF;
END $$`,
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
  "DROP TABLE IF EXISTS timer_sessions",
  "ALTER TABLE task_member_progress DROP COLUMN IF EXISTS accumulated_work_time",
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
  `CREATE TABLE IF NOT EXISTS invoices (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          VARCHAR(10)   NOT NULL CHECK (kind IN ('client', 'team')),
  client_id     UUID,
  member_id     UUID,
  number        VARCHAR(40)   NOT NULL,
  issue_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date      DATE,
  status        VARCHAR(20)   NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  subtotal      NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency      VARCHAR(10)   NOT NULL DEFAULT 'USD',
  notes         TEXT          NOT NULL DEFAULT '',
  created_by    VARCHAR(255),
  updated_by    VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (number),
  -- A client invoice needs a client, a team invoice needs a member.
  CHECK ((kind = 'client' AND client_id IS NOT NULL) OR (kind = 'team' AND member_id IS NOT NULL))
)`,
  "CREATE INDEX IF NOT EXISTS idx_invoices_kind   ON invoices (kind)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id) WHERE client_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_invoices_member ON invoices (member_id) WHERE member_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_due    ON invoices (due_date)",
  `CREATE TABLE IF NOT EXISTS invoice_line_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  project_id    UUID,
  description   TEXT          NOT NULL DEFAULT '',
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_line_items (invoice_id)",
  `CREATE TABLE IF NOT EXISTS invoice_payments (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on       DATE          NOT NULL DEFAULT CURRENT_DATE,
  method        VARCHAR(40)   NOT NULL DEFAULT 'other',
  reference     VARCHAR(120)  NOT NULL DEFAULT '',
  note          TEXT          NOT NULL DEFAULT '',
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoice_payments_paid_on ON invoice_payments (paid_on)",
  `DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices`,
  `CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TABLE IF NOT EXISTS time_off_policies (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(120)  NOT NULL,
  description       TEXT          NOT NULL DEFAULT '',
  days_per_year     NUMERIC(6,2)  NOT NULL DEFAULT 0 CHECK (days_per_year >= 0),
  paid              BOOLEAN       NOT NULL DEFAULT true,
  requires_approval BOOLEAN       NOT NULL DEFAULT true,
  active            BOOLEAN       NOT NULL DEFAULT true,
  created_by        VARCHAR(255),
  updated_by        VARCHAR(255),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (name)
)`,
  `CREATE TABLE IF NOT EXISTS time_off_requests (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID          NOT NULL,
  policy_id     UUID          NOT NULL REFERENCES time_off_policies(id) ON DELETE RESTRICT,
  start_date    DATE          NOT NULL,
  end_date      DATE          NOT NULL,
  days          NUMERIC(6,2)  NOT NULL CHECK (days > 0),
  note          TEXT          NOT NULL DEFAULT '',
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by   VARCHAR(255),
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT          NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
)`,
  "CREATE INDEX IF NOT EXISTS idx_time_off_req_member ON time_off_requests (member_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_off_req_status ON time_off_requests (status)",
  "CREATE INDEX IF NOT EXISTS idx_time_off_req_dates  ON time_off_requests (start_date, end_date)",
  `CREATE TABLE IF NOT EXISTS time_off_transactions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID          NOT NULL,
  policy_id     UUID          NOT NULL REFERENCES time_off_policies(id) ON DELETE RESTRICT,
  request_id    UUID          REFERENCES time_off_requests(id) ON DELETE CASCADE,
  kind          VARCHAR(20)   NOT NULL CHECK (kind IN ('accrual', 'usage', 'adjustment')),
  days          NUMERIC(6,2)  NOT NULL,
  effective_on  DATE          NOT NULL,
  note          TEXT          NOT NULL DEFAULT '',
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_time_off_tx_member ON time_off_transactions (member_id, policy_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_off_tx_date   ON time_off_transactions (effective_on)",
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_time_off_tx_request
     ON time_off_transactions (request_id) WHERE request_id IS NOT NULL`,
  `DROP TRIGGER IF EXISTS trg_time_off_policies_updated_at ON time_off_policies`,
  `CREATE TRIGGER trg_time_off_policies_updated_at
  BEFORE UPDATE ON time_off_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `DROP TRIGGER IF EXISTS trg_time_off_requests_updated_at ON time_off_requests`,
  `CREATE TRIGGER trg_time_off_requests_updated_at
  BEFORE UPDATE ON time_off_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TABLE IF NOT EXISTS expenses (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID          NOT NULL,
  project_id    UUID,
  client_id     UUID,
  date          DATE          NOT NULL,
  category      VARCHAR(60)   NOT NULL DEFAULT 'other',
  description   TEXT          NOT NULL DEFAULT '',
  notes         TEXT          NOT NULL DEFAULT '',
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency      VARCHAR(10)   NOT NULL DEFAULT 'USD',
  billable      BOOLEAN       NOT NULL DEFAULT false,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   VARCHAR(255),
  reviewed_at   TIMESTAMPTZ,
  receipt_url   TEXT,
  created_by    VARCHAR(255),
  updated_by    VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_expenses_member  ON expenses (member_id)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses (project_id) WHERE project_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_expenses_date    ON expenses (date)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_status  ON expenses (status)",
  `DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses`,
  `CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
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
  `CREATE TABLE IF NOT EXISTS saved_reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL,
  page_id    VARCHAR(64) NOT NULL,
  title      TEXT NOT NULL,
  tag        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, page_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_reports_member ON saved_reports (member_id, created_at DESC)`,

  ...cascadeOnDelete("activity_sessions", "member_id", "members", { nullable: false }),
  ...cascadeOnDelete("activity_sessions", "project_id", "projects"),
  ...cascadeOnDelete("activity_sessions", "task_id", "tasks"),
  ...cascadeOnDelete("activity_screenshots", "member_id", "members", { nullable: false }),
  ...cascadeOnDelete("activity_screenshots", "task_id", "tasks"),
  ...cascadeOnDelete("activity_app_logs", "member_id", "members", { nullable: false }),
  ...cascadeOnDelete("activity_app_logs", "task_id", "tasks"),
  ...cascadeOnDelete("activity_url_logs", "member_id", "members", { nullable: false }),
  ...cascadeOnDelete("activity_url_logs", "task_id", "tasks"),
  ...cascadeOnDelete("time_entries", "member_id", "members", { nullable: false }),
  ...cascadeOnDelete("time_entries", "project_id", "projects", { nullable: false }),
  ...cascadeOnDelete("time_entries", "task_id", "tasks"),
];

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

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_key)
      SELECT id, '*' FROM roles WHERE LOWER(name) IN ('superadmin', 'owner')
      ON CONFLICT (role_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_key)
      SELECT id, 'members:*' FROM roles WHERE LOWER(name) = 'admin'
      ON CONFLICT (role_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_key)
      SELECT id, 'teams:*' FROM roles WHERE LOWER(name) = 'admin'
      ON CONFLICT (role_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_key)
      SELECT id, 'projects:*' FROM roles WHERE LOWER(name) = 'admin'
      ON CONFLICT (role_id, permission_key) DO NOTHING
    `);

    // Deliberately last, and deliberately outside the DDL loop above.
    //
    // activity_url_logs had no (session_id, ...) index at all, unlike
    // activity_app_logs' idx_act_app_session_open. Two callers need one: the
    // browser category resolver matches app/screenshot rows to whichever URL
    // was open at that moment in the session, and
    // deleteActivitySessionWithChildrenPg's
    // `DELETE FROM activity_url_logs WHERE session_id = $1` was a sequential
    // scan on every session delete.
    //
    // CONCURRENTLY because a plain CREATE INDEX takes ACCESS EXCLUSIVE, and
    // this runs on every boot - on a large table that blocks all agent event
    // ingest while the backend looks hung. It is legal here only because
    // these statements are not wrapped in a transaction; it is also why this
    // cannot live in a DO block.
    //
    // Its own try/catch because CONCURRENTLY can fail transiently (a
    // conflicting long-running transaction), and the loop above has no
    // per-statement handling - an unguarded failure here would abort schema
    // setup for everything ordered after it. A miss just means the index is
    // retried next boot; queries still work, only slower.
    try {
      // A CONCURRENTLY build that fails midway leaves an INVALID index behind,
      // which IF NOT EXISTS would then skip forever - present, unusable, and
      // silently never retried. Clear that state before trying again.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'idx_act_url_session_visited' AND NOT i.indisvalid
          ) THEN
            EXECUTE 'DROP INDEX idx_act_url_session_visited';
          END IF;
        END $$;
      `);
      await client.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_act_url_session_visited
           ON activity_url_logs (session_id, visited_at)`,
      );
    } catch (indexErr) {
      logSafeWarn("[postgres] idx_act_url_session_visited not built this boot:", indexErr);
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
