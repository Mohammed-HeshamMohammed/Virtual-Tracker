-- Activity capture: screenshots, apps, URLs (PostgreSQL)
-- Dual-write from Dashboard-Backend when ACTIVITY_EVENTS_PG_ENABLED=true.
-- Screenshot bytes remain in GCS; Postgres stores metadata + object path.

BEGIN;

CREATE TABLE IF NOT EXISTS activity_screenshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL,
  session_id       VARCHAR(128) NOT NULL,
  task_id          UUID,
  task_title       VARCHAR(500),
  screenshot_url   TEXT NOT NULL,
  has_image        BOOLEAN NOT NULL DEFAULT true,
  app_name         VARCHAR(200) NOT NULL DEFAULT 'Browser',
  page_title       VARCHAR(300) NOT NULL DEFAULT '',
  activity_level   INTEGER NOT NULL DEFAULT 50 CHECK (activity_level >= 0 AND activity_level <= 100),
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))
);

CREATE INDEX IF NOT EXISTS idx_act_ss_member_captured ON activity_screenshots (member_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_ss_session ON activity_screenshots (session_id);
CREATE INDEX IF NOT EXISTS idx_act_ss_captured ON activity_screenshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS activity_app_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL,
  session_id       VARCHAR(128) NOT NULL,
  task_id          UUID,
  task_title       VARCHAR(500),
  app_name         VARCHAR(200) NOT NULL DEFAULT 'Unknown',
  page_title       VARCHAR(300) NOT NULL DEFAULT '',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds >= 0),
  source           VARCHAR(32) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'agent', 'desktop_agent'))
);

CREATE INDEX IF NOT EXISTS idx_act_app_member_started ON activity_app_logs (member_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_app_started ON activity_app_logs (started_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_act_url_member_visited ON activity_url_logs (member_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_url_visited ON activity_url_logs (visited_at DESC);

COMMIT;
