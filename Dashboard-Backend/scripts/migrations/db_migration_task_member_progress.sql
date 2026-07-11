-- Per-member task timer tracking + audit sessions (PostgreSQL mirror)
-- Tasks and members remain authoritative in Firestore; IDs are stored as UUID without FK.
-- Enable dual-write via TASK_MEMBER_PROGRESS_PG_DUAL_WRITE=true on Dashboard-Backend.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id        UUID NOT NULL,
    member_id      UUID NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL,
    ended_at       TIMESTAMPTZ,
    active_seconds BIGINT,
    idle_seconds   BIGINT,
    source         TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'desktop_agent')),
    activity_session_id VARCHAR(128)
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

COMMIT;
