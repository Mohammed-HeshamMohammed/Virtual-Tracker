-- Virtual Tracker — PostgreSQL schema for time_entries and timesheets.
-- Run once against the virtual_tracker database.

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
  created_by   UUID,
  updated_by   UUID,
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
  approved_by     UUID,
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
