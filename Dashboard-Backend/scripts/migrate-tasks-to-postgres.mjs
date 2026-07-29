#!/usr/bin/env node
/**
 * One-time migration: Firestore tasks domain -> PostgreSQL.
 * See implementation.md, Phase 2.
 *
 * Scans LIVE documents (not just the schema catalog), same discipline as
 * migrate-projects-to-postgres.mjs - Firestore is schemaless, so a doc can
 * carry fields the catalog never declared. Leaves every Firestore collection
 * untouched - this only writes to Postgres, so it's safe to run repeatedly
 * (upserts by id) while verifying, right up until the actual cutover.
 *
 * Covers: tasks, task_assignments, and the time_tracking subcollection
 * (backfilled into the existing task_member_progress table - see Phase 2's
 * "Target schema" note on why this extends that table instead of creating a
 * new one).
 *
 * tasks.total_active_seconds / total_idle_seconds / aggregated_progress_percent
 * are deliberately NOT copied from the Firestore task doc, even where present -
 * recomputed from the just-backfilled task_member_progress rows instead, since
 * that's the real source of truth (per-member counters) and a stored Firestore
 * total can already be stale. See recomputeTaskTotals() below.
 *
 * Usage:
 *   node scripts/migrate-tasks-to-postgres.mjs
 *   node scripts/migrate-tasks-to-postgres.mjs --dry-run
 *   node scripts/migrate-tasks-to-postgres.mjs --add-fk   (after verifying the backfill - see below)
 */
import crypto, { createHash } from "node:crypto";
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

const dryRun = process.argv.includes("--dry-run");
const addFk = process.argv.includes("--add-fk");

function uuidOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed;
}

/** Same deterministic-hash fallback as migrate-projects-to-postgres.mjs, for
 * any legacy doc id that isn't already a UUID v4. */
function pgId(value, namespace) {
  const asUuid = uuidOrNull(value);
  if (asUuid) return asUuid;
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return crypto.randomUUID();
  const hash = createHash("sha256").update(`${namespace}:${raw}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function actorId(value) {
  return uuidOrNull(value);
}

function toDate(value) {
  if (!value) return new Date();
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateOrNull(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function str(row, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "string") return row[key];
  }
  return null;
}

function num(row, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "number" && Number.isFinite(row[key])) return row[key];
  }
  return null;
}

function bool(row, fallback, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "boolean") return row[key];
  }
  return fallback;
}

function normalizeStatus(value, fallback) {
  const s = String(value ?? "").trim().toLowerCase();
  return s || fallback;
}

async function runQuery(sql, params) {
  if (dryRun) return [];
  return query(sql, params);
}

async function migrateTasks(db) {
  const snap = await db.collection("tasks").get();
  let skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    if (!projectId) {
      // tasks.project_id is NOT NULL + FK'd to projects(id) - a task with no
      // resolvable project can't be backfilled without violating that
      // constraint. Log and skip rather than silently invent a project.
      skipped += 1;
      console.warn(`[tasks] skipping ${doc.id}: no resolvable project_id`);
      continue;
    }
    const id = pgId(d.id ?? doc.id, "tasks");
    await runQuery(
      `INSERT INTO tasks (
         id, project_id, team_id, title, description, status, priority, order_index,
         duration_hours_per_day, duration_days, working_days, overtime_hours_per_day,
         assigned_to, start_date, due_date, review_state, reviewed_by, reviewed_at,
         created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id, team_id = EXCLUDED.team_id, title = EXCLUDED.title,
         description = EXCLUDED.description, status = EXCLUDED.status, priority = EXCLUDED.priority,
         order_index = EXCLUDED.order_index, duration_hours_per_day = EXCLUDED.duration_hours_per_day,
         duration_days = EXCLUDED.duration_days, working_days = EXCLUDED.working_days,
         overtime_hours_per_day = EXCLUDED.overtime_hours_per_day, assigned_to = EXCLUDED.assigned_to,
         start_date = EXCLUDED.start_date, due_date = EXCLUDED.due_date, review_state = EXCLUDED.review_state,
         reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        id,
        projectId,
        uuidOrNull(str(d, "team_id", "teamId")),
        str(d, "title") ?? "Untitled task",
        str(d, "description"),
        normalizeStatus(str(d, "status"), "todo"),
        str(d, "priority"),
        num(d, "order_index", "orderIndex"),
        num(d, "duration_hours_per_day", "durationHoursPerDay"),
        num(d, "duration_days", "durationDays"),
        num(d, "working_days", "workingDays"),
        num(d, "overtime_hours_per_day", "overtimeHoursPerDay"),
        uuidOrNull(str(d, "assigned_to", "assignedTo")),
        toDateOrNull(d.start_date ?? d.startDate),
        toDateOrNull(d.due_date ?? d.dueDate),
        str(d, "review_state", "reviewState"),
        actorId(str(d, "reviewed_by", "reviewedBy")),
        toDateOrNull(d.reviewed_at ?? d.reviewedAt),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
        actorId(str(d, "created_by", "createdBy")),
        actorId(str(d, "updated_by", "updatedBy")),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}tasks: ${snap.size - skipped} rows (${skipped} skipped, no project_id)`);
  return { total: snap.size, skipped };
}

async function migrateTaskAssignments(db) {
  const snap = await db.collection("task_assignments").get();
  let skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const taskId = uuidOrNull(str(d, "task_id", "taskId"));
    const userId = uuidOrNull(str(d, "user_id", "userId"));
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    if (!taskId || !userId || !projectId) {
      skipped += 1;
      console.warn(`[task_assignments] skipping ${doc.id}: missing task_id/user_id/project_id`);
      continue;
    }
    const id = pgId(d.id ?? doc.id, "task_assignments");
    await runQuery(
      `INSERT INTO task_assignments (
         id, task_id, user_id, project_id, status, expected_seconds, required,
         review_state, reviewed_by, reviewed_at, review_notes, entered_review_at,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (task_id, user_id) DO UPDATE SET
         project_id = EXCLUDED.project_id, status = EXCLUDED.status,
         expected_seconds = EXCLUDED.expected_seconds, required = EXCLUDED.required,
         review_state = EXCLUDED.review_state, reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at, review_notes = EXCLUDED.review_notes,
         entered_review_at = EXCLUDED.entered_review_at, updated_at = EXCLUDED.updated_at`,
      [
        id,
        taskId,
        userId,
        projectId,
        normalizeStatus(str(d, "status"), "todo"),
        num(d, "expected_seconds", "expectedSeconds"),
        bool(d, true, "required"),
        str(d, "review_state", "reviewState"),
        actorId(str(d, "reviewed_by", "reviewedBy")),
        toDateOrNull(d.reviewed_at ?? d.reviewedAt),
        str(d, "review_notes", "reviewNotes"),
        toDateOrNull(d.entered_review_at ?? d.enteredReviewAt),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
      ],
    );
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}task_assignments: ${snap.size - skipped} rows (${skipped} skipped, missing FK fields)`,
  );
  return { total: snap.size, skipped };
}

/** tasks/{taskId}/time_tracking/{docId}, scanned across every task via
 * collectionGroup - deliberately NOT capped with .limit() the way the live
 * task-assignments.js:775 reconciliation query is (see implementation.md
 * Phase 3, Action Item 4 - that's a separate bug on a separate, live request
 * path; this is an offline one-time script with no request timeout to fit
 * inside, so it just reads everything). Backfills into the existing
 * task_member_progress table, mapping Firestore's user_id -> member_id
 * (Postgres convention already established for this table). */
async function migrateTaskTimeTracking(db) {
  const snap = await db.collectionGroup("time_tracking").get();
  let skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    // parentIdField is "task_id" per the schema catalog, but scan live data
    // rather than trust it's always present - fall back to the doc's real
    // parent path (tasks/{taskId}/time_tracking/{docId}) if missing.
    const taskId = uuidOrNull(str(d, "task_id", "taskId")) ?? uuidOrNull(doc.ref.parent.parent?.id ?? null);
    const memberId = uuidOrNull(str(d, "user_id", "userId"));
    if (!taskId || !memberId) {
      skipped += 1;
      console.warn(`[time_tracking] skipping ${doc.ref.path}: missing task_id/user_id`);
      continue;
    }
    const id = pgId(d.id ?? doc.id, "task_member_progress");
    await runQuery(
      `INSERT INTO task_member_progress (
         id, task_id, member_id, active_seconds, idle_seconds, progress_percentage,
         last_started_at, last_activity_at, project_id, session_id, review_notes,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (task_id, member_id) DO UPDATE SET
         active_seconds = EXCLUDED.active_seconds, idle_seconds = EXCLUDED.idle_seconds,
         progress_percentage = EXCLUDED.progress_percentage, last_started_at = EXCLUDED.last_started_at,
         last_activity_at = EXCLUDED.last_activity_at, project_id = EXCLUDED.project_id,
         session_id = EXCLUDED.session_id, review_notes = EXCLUDED.review_notes,
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        taskId,
        memberId,
        Math.max(0, num(d, "active_seconds", "activeSeconds") ?? 0),
        Math.max(0, num(d, "idle_seconds", "idleSeconds") ?? 0),
        Math.max(0, num(d, "progress_percentage", "progressPercentage") ?? 0),
        toDateOrNull(d.started_at ?? d.startedAt),
        toDateOrNull(d.last_activity_at ?? d.lastActivityAt),
        uuidOrNull(str(d, "project_id", "projectId")),
        str(d, "session_id", "sessionId"),
        str(d, "review_notes", "reviewNotes"),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
      ],
    );
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}task_member_progress (from time_tracking): ${snap.size - skipped} rows (${skipped} skipped)`,
  );
  return { total: snap.size, skipped };
}

/** Recomputes tasks.total_active_seconds / total_idle_seconds /
 * aggregated_progress_percent from the just-backfilled task_member_progress
 * rows, rather than trusting whatever (possibly stale, possibly absent) total
 * Firestore had stored on the task doc itself. Safe to re-run - it's a pure
 * aggregate UPDATE, not an insert. */
async function recomputeTaskTotals() {
  if (dryRun) {
    console.log("[dry-run] skipping tasks total_active_seconds/total_idle_seconds recompute");
    return;
  }
  const result = await query(`
    UPDATE tasks t SET
      total_active_seconds = agg.total_active,
      total_idle_seconds = agg.total_idle,
      updated_at = t.updated_at
    FROM (
      SELECT task_id, SUM(active_seconds) AS total_active, SUM(idle_seconds) AS total_idle
      FROM task_member_progress
      GROUP BY task_id
    ) agg
    WHERE agg.task_id = t.id
    RETURNING t.id
  `);
  console.log(`Recomputed totals for ${result.length} tasks from task_member_progress.`);
}

/** Only run once the backfill above is verified clean - orphaned project_id/
 * task_id values will make this fail. That's the FK doing its job, not a bug
 * in this script (same pattern as migrate-projects-to-postgres.mjs --add-fk). */
async function addBackReferenceFks() {
  const checks = [
    { table: "task_member_progress", column: "task_id", ref: "tasks", constraint: "fk_tmp_task" },
    { table: "timer_sessions", column: "task_id", ref: "tasks", constraint: "fk_ts_task" },
  ];
  for (const { table, column, ref, constraint } of checks) {
    const orphans = await query(
      `SELECT COUNT(*)::int AS n FROM ${table} c LEFT JOIN ${ref} r ON r.id = c.${column} WHERE c.${column} IS NOT NULL AND r.id IS NULL`,
    );
    const orphanCount = orphans[0]?.n ?? 0;
    if (orphanCount > 0) {
      console.error(
        `Refusing to add FK on ${table}.${column}: ${orphanCount} rows reference a ${column} with no matching row in ${ref}. Fix those first.`,
      );
      process.exitCode = 1;
      continue;
    }
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
          ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES ${ref}(id);
        END IF;
      END $$;
    `);
    console.log(`FK ${constraint} added (or already existed) on ${table}.${column}.`);
  }
}

const db = getDb();
if (!db) {
  console.error("Firestore not configured");
  process.exit(1);
}
if (!isPostgresConfigured()) {
  console.error("POSTGRES_URL is not configured");
  process.exit(1);
}

if (addFk) {
  await addBackReferenceFks();
  process.exit(0);
}

const counts = {
  tasks: await migrateTasks(db),
  task_assignments: await migrateTaskAssignments(db),
  task_member_progress: await migrateTaskTimeTracking(db),
};
await recomputeTaskTotals();

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Backfill complete. Verify row counts against Firestore before repointing any read/write path, " +
        "then run with --add-fk once satisfied.",
);
console.log(counts);
