import { query } from "./client.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseProgressUuid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function computeProgressPercentage(activeSeconds, plannedSeconds) {
  const active = Math.max(0, Math.floor(activeSeconds ?? 0));
  if (!plannedSeconds || plannedSeconds <= 0) return 0;
  return Math.min(100, Math.round((active / plannedSeconds) * 100));
}


const TRACKING_COLUMNS = [
  "id",
  "task_id",
  "member_id",
  "project_id",
  "active_seconds",
  "idle_seconds",
  "progress_percentage",
  "last_started_at",
  "rolling_session_started_at",
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

export async function getTrackingRowPg(taskId, memberId) {
  const rows = await query(
    `SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress WHERE task_id = $1 AND member_id = $2 LIMIT 1`,
    [taskId, memberId],
  );
  return rows[0] ? normalizeTrackingRow(rows[0]) : null;
}

export async function getTaskTrackingRowsPg(taskId) {
  const rows = await query(`SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress WHERE task_id = $1`, [taskId]);
  return rows.map(normalizeTrackingRow);
}

export async function getAllTrackingRowsPg(limit = 5000) {
  const rows = await query(`SELECT ${TRACKING_COLUMNS.join(", ")} FROM task_member_progress ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(normalizeTrackingRow);
}

export async function upsertTrackingRowPg(payload, options = {}) {
  const allowDecrease = options.allowDecrease === true;
  const activeSet = allowDecrease
    ? "EXCLUDED.active_seconds"
    : "GREATEST(task_member_progress.active_seconds, EXCLUDED.active_seconds)";
  const rows = await query(
    `INSERT INTO task_member_progress (
       task_id, member_id, project_id, active_seconds, idle_seconds, progress_percentage,
       last_started_at, rolling_session_started_at, last_activity_at, session_id, review_notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,
       CASE $11::text WHEN 'start' THEN $8::timestamptz ELSE NULL END,
       $8,$9,$10)
     ON CONFLICT (task_id, member_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       active_seconds = ${activeSet},
       idle_seconds = GREATEST(task_member_progress.idle_seconds, EXCLUDED.idle_seconds),
       progress_percentage = EXCLUDED.progress_percentage,
       last_started_at = COALESCE(task_member_progress.last_started_at, EXCLUDED.last_started_at),
       rolling_session_started_at = CASE $11::text
         WHEN 'start' THEN EXCLUDED.rolling_session_started_at
         WHEN 'stop' THEN NULL
         ELSE task_member_progress.rolling_session_started_at
       END,
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
      payload.action ?? "",
    ],
  );
  return normalizeTrackingRow(rows[0]);
}

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
