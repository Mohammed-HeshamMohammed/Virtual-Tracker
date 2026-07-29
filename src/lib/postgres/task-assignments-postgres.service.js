// Postgres-backed CRUD for task_assignments (Phase 2 of implementation.md -
// Firestore -> Postgres). Table + backfill already existed (Phase 2 step 1/2);
// this is what actually repoints the assignment lifecycle/review workflow in
// task-assignments.js, task-time-tracking.js, task-workload-validation.js,
// task-access.js, and tasks/routes.js off Firestore.

import crypto from "node:crypto";
import { query } from "./client.js";

const ASSIGNMENT_COLUMNS = [
  "id",
  "task_id",
  "member_id",
  "project_id",
  "status",
  "expected_seconds",
  "required",
  "review_state",
  "reviewed_by",
  "reviewed_at",
  "review_notes",
  "entered_review_at",
  "created_at",
  "updated_at",
];

function normalizeAssignmentRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) out[key] = value.toISOString();
  }
  return out;
}

/** @param {string} taskId @param {string} memberId */
export async function findAssignmentPg(taskId, memberId) {
  const rows = await query(
    `SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments WHERE task_id = $1 AND member_id = $2 LIMIT 1`,
    [taskId, memberId],
  );
  return rows[0] ? normalizeAssignmentRow(rows[0]) : null;
}

/** @param {string} id */
export async function getAssignmentByIdPg(id) {
  const rows = await query(`SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalizeAssignmentRow(rows[0]) : null;
}

/** @param {string} taskId */
export async function getTaskAssignmentsPg(taskId) {
  const rows = await query(`SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments WHERE task_id = $1`, [taskId]);
  return rows.map(normalizeAssignmentRow);
}

/** Upsert by (task_id, member_id) - matches the table's UNIQUE constraint and
 * the create-or-update pattern syncTaskAssignments/ensureAssignmentForUser need. */
export async function upsertAssignmentPg(payload) {
  const id = payload.id ?? crypto.randomUUID();
  const rows = await query(
    `INSERT INTO task_assignments (
       id, task_id, member_id, project_id, status, expected_seconds, required,
       review_state, reviewed_by, reviewed_at, review_notes, entered_review_at,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (task_id, member_id) DO UPDATE SET
       project_id = EXCLUDED.project_id, status = EXCLUDED.status,
       expected_seconds = EXCLUDED.expected_seconds, required = EXCLUDED.required,
       updated_at = EXCLUDED.updated_at
     RETURNING ${ASSIGNMENT_COLUMNS.join(", ")}`,
    [
      id,
      payload.task_id,
      payload.member_id,
      payload.project_id ?? null,
      payload.status ?? "todo",
      payload.expected_seconds ?? null,
      payload.required ?? true,
      payload.review_state ?? null,
      payload.reviewed_by ?? null,
      payload.reviewed_at ?? null,
      payload.review_notes ?? "",
      payload.entered_review_at ?? null,
      payload.created_at ?? new Date(),
      payload.updated_at ?? new Date(),
    ],
  );
  return normalizeAssignmentRow(rows[0]);
}

/** @param {string} id @param {Record<string, unknown>} patch */
export async function updateAssignmentPg(id, patch) {
  const columns = {
    project_id: "project_id",
    status: "status",
    expected_seconds: "expected_seconds",
    required: "required",
    review_state: "review_state",
    reviewed_by: "reviewed_by",
    reviewed_at: "reviewed_at",
    review_notes: "review_notes",
    entered_review_at: "entered_review_at",
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getAssignmentByIdPg(id);
  sets.push("updated_at = now()");
  const rows = await query(
    `UPDATE task_assignments SET ${sets.join(", ")} WHERE id = $1 RETURNING ${ASSIGNMENT_COLUMNS.join(", ")}`,
    params,
  );
  return rows[0] ? normalizeAssignmentRow(rows[0]) : null;
}

/** @param {string} id */
export async function deleteAssignmentPg(id) {
  await query("DELETE FROM task_assignments WHERE id = $1", [id]);
}

/** Task IDs assigned to any of these members - no 30-item chunking needed,
 * unlike the Firestore `in` version, since Postgres has no arity cap on ANY(). */
export async function getTaskIdsAssignedToMembersPg(memberIds) {
  const unique = [...new Set(memberIds.filter(Boolean))];
  if (!unique.length) return new Set();
  const rows = await query("SELECT DISTINCT task_id FROM task_assignments WHERE member_id = ANY($1::uuid[])", [unique]);
  return new Set(rows.map((r) => r.task_id));
}

/** Every assignment for a set of tasks - no chunking, no arbitrary .limit(500) cap. */
export async function getAssignmentsForTasksPg(taskIds) {
  const unique = [...new Set(taskIds.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await query(
    `SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments WHERE task_id = ANY($1::uuid[])`,
    [unique],
  );
  return rows.map(normalizeAssignmentRow);
}

/** Full scan for the review-queue sweep - no hardcoded .limit(500) cap the way
 * the old Firestore query had (the exact bug flagged in implementation.md
 * Phase 3, Action Item 4). A high default is still passed so this can't
 * silently return an unbounded result set either. */
export async function listAllAssignmentsPg(limit = 5000) {
  const rows = await query(`SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(normalizeAssignmentRow);
}

/** @param {string} taskId */
export async function getInReviewAssignmentsForTaskPg(taskId) {
  const rows = await query(
    `SELECT ${ASSIGNMENT_COLUMNS.join(", ")} FROM task_assignments WHERE task_id = $1 AND status = 'in_review' LIMIT 50`,
    [taskId],
  );
  return rows.map(normalizeAssignmentRow);
}

/** Sum of expected_seconds across a member's non-terminal assignments,
 * optionally excluding one task - matches task-workload-validation.js's
 * TERMINAL_STATUSES set exactly. */
export async function sumActiveAssignmentSecondsPg(memberId, excludeTaskId) {
  const rows = await query(
    `SELECT COALESCE(SUM(expected_seconds), 0) AS total
     FROM task_assignments
     WHERE member_id = $1 AND status NOT IN ('done', 'cancelled')
       ${excludeTaskId ? "AND task_id != $2" : ""}`,
    excludeTaskId ? [memberId, excludeTaskId] : [memberId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** True if this member has any assignment row on this task - the "was I
 * assigned" check task-access.js and tasks/routes.js need. */
export async function hasAssignmentPg(taskId, memberId) {
  const rows = await query("SELECT 1 FROM task_assignments WHERE task_id = $1 AND member_id = $2 LIMIT 1", [taskId, memberId]);
  return rows.length > 0;
}
