// Postgres-backed CRUD for the tasks table (Phase 2 of implementation.md -
// Firestore -> Postgres). Scope is deliberately narrower than the analogous
// projects-postgres.service.js: this covers `tasks` base CRUD only.
// `task_assignments`, task-time-tracking sync, and workload/allowance
// enforcement (task-assignments.js, task-time-tracking.js,
// task-workload-validation.js) are NOT migrated yet and still read/write
// Firestore - see implementation.md Phase 2 for the remaining scope.

import crypto from "node:crypto";
import { query } from "./client.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

// Fields task-time-tracking.js's aggregateTaskProgress() recomputes on
// every activity sync (every SESSION_SYNC_INTERVAL_SEC while anyone is
// actively tracking - far more often than a real edit). A patch touching
// only these is bookkeeping, not something a user did; broadcasting it
// would turn routine ticking into a live-sync storm for no reader that
// needs it. A real status/assignment change still reaches the wire, either
// through the other fields on this same patch or through the
// "task-assignments" resource that assignment writes publish separately.
const TASK_BOOKKEEPING_ONLY_KEYS = new Set([
  "total_active_seconds",
  "total_idle_seconds",
  "aggregated_progress_percent",
  "total_assignees",
  "started_assignees",
  "not_started_assignees",
  "participation_percent",
  "all_assignees_started",
]);

function uuidOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed;
}

function dateOnly(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TASK_COLUMNS = [
  "id",
  "project_id",
  "team_id",
  "title",
  "description",
  "status",
  "priority",
  "order_index",
  "duration_hours_per_day",
  "duration_days",
  "working_days",
  "overtime_hours_per_day",
  "rolling_hour_cap",
  "shared_task_budget",
  "assigned_to",
  "start_date",
  "due_date",
  "review_state",
  "reviewed_by",
  "reviewed_at",
  "total_active_seconds",
  "total_idle_seconds",
  "aggregated_progress_percent",
  "completed",
  "total_assignees",
  "started_assignees",
  "not_started_assignees",
  "participation_percent",
  "all_assignees_started",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
];

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function normalizeTaskRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) {
      out[key] = key === "start_date" || key === "due_date" ? value.toISOString().slice(0, 10) : value.toISOString();
    }
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== key) out[camel] = out[key];
  }
  return out;
}

/** @param {Record<string, unknown>} payload - already coerced/validated by buildCreatePayload */
export async function createTaskPg(payload) {
  const id = uuidOrNull(String(payload.id ?? "")) ?? crypto.randomUUID();
  const rows = await query(
    `INSERT INTO tasks (
       id, project_id, team_id, title, description, status, priority, order_index,
       duration_hours_per_day, duration_days, working_days, overtime_hours_per_day, rolling_hour_cap,
       shared_task_budget, assigned_to, start_date, due_date, review_state, reviewed_by, reviewed_at,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING ${TASK_COLUMNS.join(", ")}`,
    [
      id,
      payload.project_id,
      payload.team_id ?? null,
      payload.title,
      payload.description ?? null,
      payload.status ?? "todo",
      payload.priority ?? null,
      payload.order_index ?? null,
      payload.duration_hours_per_day ?? null,
      payload.duration_days ?? null,
      payload.working_days ?? null,
      payload.overtime_hours_per_day ?? null,
      payload.rolling_hour_cap === true,
      payload.shared_task_budget === true,
      payload.assigned_to ?? null,
      dateOnly(payload.start_date),
      dateOnly(payload.due_date),
      payload.review_state ?? null,
      payload.reviewed_by ?? null,
      payload.reviewed_at ?? null,
      payload.created_at ?? new Date(),
      payload.updated_at ?? new Date(),
      payload.created_by ?? null,
      payload.updated_by ?? null,
    ],
  );
  void publishChange("tasks", id, "created", payload.created_by ?? undefined);
  return normalizeTaskRow(rows[0]);
}

/** @param {string} id */
export async function getTaskPg(id) {
  const rows = await query(`SELECT ${TASK_COLUMNS.join(", ")} FROM tasks WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalizeTaskRow(rows[0]) : null;
}

/** @param {string[]} ids */
export async function getTasksByIdsPg(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await query(`SELECT ${TASK_COLUMNS.join(", ")} FROM tasks WHERE id = ANY($1::uuid[])`, [unique]);
  return rows.map(normalizeTaskRow);
}

/**
 * @param {{ projectId?: string, teamId?: string, status?: string, assignedTo?: string, limit?: number }} [filters]
 */
export async function listTasksPg(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.projectId) {
    params.push(filters.projectId);
    conditions.push(`project_id = $${params.length}`);
  }
  if (filters.teamId) {
    params.push(filters.teamId);
    conditions.push(`team_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`assigned_to = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // Ceiling raised from 500 to 5000 - dashboard-base-loader.js requests 800 and was
  // being silently clamped down to 500 without either caller knowing.
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 5000);
  const rows = await query(
    `SELECT ${TASK_COLUMNS.join(", ")} FROM tasks ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map(normalizeTaskRow);
}

/**
 * @param {string} id @param {Record<string, unknown>} payload - already coerced/validated by buildUpdatePayload
 * @param {string} [expectedUpdatedAt] Optimistic-concurrency token (§6.9),
 *   optional. Only ever passed by the user-facing edit route - the
 *   frequent bookkeeping callers (task-time-tracking.js, recomputeTaskStatus)
 *   never send one, so their writes stay unconditional as before.
 */
export async function updateTaskPg(id, payload, expectedUpdatedAt) {
  const columns = {
    project_id: "project_id",
    team_id: "team_id",
    title: "title",
    description: "description",
    status: "status",
    priority: "priority",
    order_index: "order_index",
    duration_hours_per_day: "duration_hours_per_day",
    duration_days: "duration_days",
    working_days: "working_days",
    overtime_hours_per_day: "overtime_hours_per_day",
    rolling_hour_cap: "rolling_hour_cap",
    shared_task_budget: "shared_task_budget",
    assigned_to: "assigned_to",
    start_date: "start_date",
    due_date: "due_date",
    review_state: "review_state",
    reviewed_by: "reviewed_by",
    reviewed_at: "reviewed_at",
    updated_by: "updated_by",
    // Participation counters - see the ALTER TABLE tasks comment in
    // ensure-lookup-schema.js. Written by task-assignments.js's
    // recomputeTaskStatus(), not user-facing edit forms.
    completed: "completed",
    total_assignees: "total_assignees",
    started_assignees: "started_assignees",
    not_started_assignees: "not_started_assignees",
    participation_percent: "participation_percent",
    all_assignees_started: "all_assignees_started",
    // Written by task-time-tracking.js's aggregateTaskProgress() after summing
    // task_member_progress rows - see implementation.md Phase 4.8 on why this
    // should eventually be a DB trigger instead of an app-code recompute step.
    total_active_seconds: "total_active_seconds",
    total_idle_seconds: "total_idle_seconds",
    aggregated_progress_percent: "aggregated_progress_percent",
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in payload)) continue;
    const value = key === "start_date" || key === "due_date" ? dateOnly(payload[key]) : payload[key];
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getTaskPg(id);
  sets.push("updated_at = now()");
  // See projects-postgres.service.js's updateProjectPg for why this must be
  // millisecond-truncated on both sides (now() vs a JS Date round-trip).
  const where = expectedUpdatedAt
    ? `WHERE id = $1 AND date_trunc('milliseconds', updated_at) = $${params.push(expectedUpdatedAt)}::timestamptz`
    : "WHERE id = $1";
  const rows = await query(`UPDATE tasks SET ${sets.join(", ")} ${where} RETURNING ${TASK_COLUMNS.join(", ")}`, params);
  if (rows.length === 0 && expectedUpdatedAt) {
    return { conflict: true, current: await getTaskPg(id) };
  }
  const isBookkeepingOnly = Object.keys(payload).every((key) => TASK_BOOKKEEPING_ONLY_KEYS.has(key));
  if (rows[0] && !isBookkeepingOnly) {
    void publishChange("tasks", id, "updated", payload.updated_by ?? undefined);
  }
  return rows[0] ? normalizeTaskRow(rows[0]) : null;
}

/** @param {string} id @param {string} [actorId] */
export async function deleteTaskPg(id, actorId) {
  await query("DELETE FROM tasks WHERE id = $1", [id]);
  void publishChange("tasks", id, "deleted", actorId ?? undefined);
}
