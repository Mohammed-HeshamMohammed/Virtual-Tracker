import { getEnv } from "../../config/env.js";
import { getPostgresPool } from "./client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function parseProgressUuid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * @param {number} activeSeconds
 * @param {number | null | undefined} plannedSeconds
 * @returns {number}
 */
export function computeProgressPercentage(activeSeconds, plannedSeconds) {
  const active = Math.max(0, Math.floor(activeSeconds ?? 0));
  if (!plannedSeconds || plannedSeconds <= 0) return 0;
  return Math.min(100, Math.round((active / plannedSeconds) * 100));
}

/** @returns {boolean} */
export function isTaskMemberProgressPgEnabled() {
  const env = getEnv();
  if (!env.postgres.url) return false;
  return env.features.taskMemberProgressPgDualWrite === true;
}

/**
 * @param {string} sql
 * @param {unknown[]} params
 */
async function pgQuery(sql, params = []) {
  const pool = getPostgresPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Dual-write mirror of Firestore task-time-tracking. Failures are logged, never block Firestore sync.
 *
 * @param {{
 *   taskId: string,
 *   memberId: string,
 *   action: string,
 *   activeSeconds: number,
 *   idleSeconds: number,
 *   sessionId?: string | null,
 *   plannedSeconds?: number | null,
 *   source?: 'web' | 'desktop_agent',
 * }} input
 */
export async function syncMemberProgressToPostgres(input) {
  if (!isTaskMemberProgressPgEnabled()) return null;

  const taskId = parseProgressUuid(input.taskId);
  const memberId = parseProgressUuid(input.memberId);
  if (!taskId || !memberId) return null;

  const action = String(input.action ?? "sync").toLowerCase();
  const activeSeconds = Math.max(0, Math.floor(input.activeSeconds ?? 0));
  const idleSeconds = Math.max(0, Math.floor(input.idleSeconds ?? 0));
  const progressPct = computeProgressPercentage(activeSeconds, input.plannedSeconds ?? null);
  const source = input.source === "desktop_agent" ? "desktop_agent" : "web";
  const activitySessionId =
    typeof input.sessionId === "string" && input.sessionId.trim() ? input.sessionId.trim() : null;
  const now = new Date();

  try {
    await pgQuery(
      `INSERT INTO task_member_progress (
         task_id, member_id, active_seconds, idle_seconds, progress_percentage,
         accumulated_work_time, last_started_at, last_activity_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (task_id, member_id) DO UPDATE SET
         active_seconds = EXCLUDED.active_seconds,
         idle_seconds = EXCLUDED.idle_seconds,
         progress_percentage = EXCLUDED.progress_percentage,
         accumulated_work_time = GREATEST(task_member_progress.accumulated_work_time, EXCLUDED.active_seconds),
         last_started_at = CASE
           WHEN $9 IN ('start', 'resume') AND task_member_progress.last_started_at IS NULL
             THEN EXCLUDED.last_started_at
           ELSE task_member_progress.last_started_at
         END,
         last_activity_at = EXCLUDED.last_activity_at,
         updated_at = now()`,
      [
        taskId,
        memberId,
        activeSeconds,
        idleSeconds,
        progressPct,
        activeSeconds,
        action === "start" || action === "resume" ? now : null,
        now,
        action,
      ],
    );

    if (action === "start" || action === "resume") {
      await pgQuery(
        `INSERT INTO timer_sessions (task_id, member_id, started_at, source, activity_session_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [taskId, memberId, now, source, activitySessionId],
      );
    } else if (action === "stop") {
      await pgQuery(
        `UPDATE timer_sessions
         SET ended_at = $3, active_seconds = $4, idle_seconds = $5
         WHERE id = (
           SELECT id FROM timer_sessions
           WHERE task_id = $1 AND member_id = $2 AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
         )`,
        [taskId, memberId, now, activeSeconds, idleSeconds],
      );
    } else if (action === "sync" || action === "idle") {
      await pgQuery(
        `UPDATE timer_sessions
         SET active_seconds = $3, idle_seconds = $4
         WHERE id = (
           SELECT id FROM timer_sessions
           WHERE task_id = $1 AND member_id = $2 AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
         )`,
        [taskId, memberId, activeSeconds, idleSeconds],
      );
    }

    return { taskId, memberId, activeSeconds, idleSeconds, progressPct };
  } catch (err) {
    logSafeWarn("[task-member-progress pg sync]", err);
    return null;
  }
}

/**
 * @param {string} taskId
 * @param {string} memberId
 */
export async function getMyProgressFromPostgres(taskId, memberId) {
  if (!isTaskMemberProgressPgEnabled()) return null;
  const tid = parseProgressUuid(taskId);
  const mid = parseProgressUuid(memberId);
  if (!tid || !mid) return null;

  const result = await pgQuery(
    `SELECT task_id, member_id, active_seconds, idle_seconds, progress_percentage,
            accumulated_work_time, last_started_at, last_activity_at, updated_at
     FROM task_member_progress
     WHERE task_id = $1 AND member_id = $2
     LIMIT 1`,
    [tid, mid],
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  return normalizeProgressRow(row);
}

/**
 * @param {string} taskId
 */
export async function getTaskProgressAggregateFromPostgres(taskId) {
  if (!isTaskMemberProgressPgEnabled()) return null;
  const tid = parseProgressUuid(taskId);
  if (!tid) return null;

  const agg = await pgQuery(
    `SELECT task_id, total_active_seconds, total_idle_seconds, contributing_members
     FROM task_progress_aggregate
     WHERE task_id = $1`,
    [tid],
  );
  const breakdown = await pgQuery(
    `SELECT member_id, active_seconds, idle_seconds, progress_percentage, last_activity_at
     FROM task_member_progress
     WHERE task_id = $1
     ORDER BY active_seconds DESC`,
    [tid],
  );

  return {
    aggregate: agg?.rows?.[0] ?? null,
    memberBreakdown: (breakdown?.rows ?? []).map(normalizeProgressRow),
  };
}

/**
 * @param {Record<string, unknown>} row
 */
function normalizeProgressRow(row) {
  return {
    taskId: String(row.task_id ?? ""),
    memberId: String(row.member_id ?? ""),
    activeSeconds: Number(row.active_seconds ?? 0),
    idleSeconds: Number(row.idle_seconds ?? 0),
    progressPercentage: Number(row.progress_percentage ?? 0),
    accumulatedWorkTime: Number(row.accumulated_work_time ?? 0),
    lastStartedAt: row.last_started_at instanceof Date ? row.last_started_at.toISOString() : row.last_started_at ?? null,
    lastActivityAt: row.last_activity_at instanceof Date ? row.last_activity_at.toISOString() : row.last_activity_at ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
  };
}
