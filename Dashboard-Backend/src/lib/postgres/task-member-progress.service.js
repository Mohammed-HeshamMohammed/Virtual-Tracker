import { query } from "./client.js";

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

// ---------------------------------------------------------------------------
// Primary read/write path (Phase 2 of implementation.md - task_member_progress
// is the real store for task time tracking, not a mirror). task-time-tracking.js
// and task-assignments.js call these directly.
// ---------------------------------------------------------------------------

const TRACKING_COLUMNS = [
  "id",
  "task_id",
  "member_id",
  "project_id",
  "active_seconds",
  "idle_seconds",
  "progress_percentage",
  "last_started_at",
  "last_activity_at",
  "session_id",
  "review_notes",
  "created_at",
  "updated_at",
];

function normalizeTrackingRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) out[key] = value.toISOString();
  }
  return out;
}

/** @param {string} taskId @param {string} memberId */
export async function getTrackingRowPg(taskId, memberId) {
  const rows = await query(
    `SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress WHERE task_id = $1 AND member_id = $2 LIMIT 1`,
    [taskId, memberId],
  );
  return rows[0] ? normalizeTrackingRow(rows[0]) : null;
}

/** @param {string} taskId */
export async function getTaskTrackingRowsPg(taskId) {
  const rows = await query(`SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress WHERE task_id = $1`, [taskId]);
  return rows.map(normalizeTrackingRow);
}

/** Full scan for the review-queue sweep - replaces collectionGroup("time_tracking")
 * with a real .limit(500) cap that silently dropped rows past it (implementation.md
 * Phase 3, Action Item 4 territory, same bug class as task_assignments had). */
export async function getAllTrackingRowsPg(limit = 5000) {
  const rows = await query(`SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(normalizeTrackingRow);
}

/**
 * Upsert by (task_id, member_id) - the live counter write syncTaskTimeTracking
 * makes on every start/idle/resume/stop/sync action.
 *
 * TC-4: active_seconds is clamped to never regress (GREATEST against the
 * existing row) unless `allowDecrease` is set - the one legitimate case is
 * the desktop agent's idle-escalation rewind, posted as action "stop", which
 * *must* be able to lower it (that rewind is the anti-fraud mechanism).
 * idle_seconds is always clamped up; nothing in the product legitimately
 * lowers it. Without this, two devices racing on the same task (each holding
 * its own stale baseline) or a slow request landing after a later one
 * silently destroys recorded time.
 *
 * @param {{ allowDecrease?: boolean }} [options]
 */
export async function upsertTrackingRowPg(payload, options = {}) {
  const allowDecrease = options.allowDecrease === true;
  const activeSet = allowDecrease
    ? "EXCLUDED.active_seconds"
    : "GREATEST(task_member_progress.active_seconds, EXCLUDED.active_seconds)";
  const rows = await query(
    `INSERT INTO task_member_progress (
       task_id, member_id, project_id, active_seconds, idle_seconds, progress_percentage,
       last_started_at, last_activity_at, session_id, review_notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (task_id, member_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       active_seconds = ${activeSet},
       idle_seconds = GREATEST(task_member_progress.idle_seconds, EXCLUDED.idle_seconds),
       progress_percentage = EXCLUDED.progress_percentage,
       last_started_at = COALESCE(task_member_progress.last_started_at, EXCLUDED.last_started_at),
       last_activity_at = EXCLUDED.last_activity_at,
       session_id = COALESCE(EXCLUDED.session_id, task_member_progress.session_id),
       updated_at = now()
     RETURNING ${TRACKING_COLUMNS.join(", ")}`,
    [
      payload.task_id,
      payload.member_id,
      payload.project_id ?? null,
      payload.active_seconds ?? 0,
      payload.idle_seconds ?? 0,
      payload.progress_percentage ?? 0,
      payload.last_started_at ?? null,
      payload.last_activity_at ?? new Date(),
      payload.session_id ?? null,
      payload.review_notes ?? "",
    ],
  );
  return normalizeTrackingRow(rows[0]);
}

/** Just the review_notes + progress_percentage fields - what
 * aggregateTaskProgress and reviewAssignment need to patch without
 * re-sending the full counter state. */
export async function updateTrackingFieldsPg(taskId, memberId, patch) {
  const columns = { progress_percentage: "progress_percentage", review_notes: "review_notes" };
  const sets = [];
  const params = [taskId, memberId];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getTrackingRowPg(taskId, memberId);
  sets.push("updated_at = now()");
  const rows = await query(
    `UPDATE task_member_progress SET ${sets.join(", ")} WHERE task_id = $1 AND member_id = $2 RETURNING ${TRACKING_COLUMNS.join(", ")}`,
    params,
  );
  return rows[0] ? normalizeTrackingRow(rows[0]) : null;
}
