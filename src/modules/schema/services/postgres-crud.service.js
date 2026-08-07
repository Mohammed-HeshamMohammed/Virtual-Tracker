import { isPostgresConfigured, query } from "../../../lib/postgres/client.js";
import { isPostgresLookupReady } from "../../../lib/postgres/lookup-availability.js";
import { isPostgresMemberDataReady } from "../../../lib/postgres/member-data-availability.js";
import {
  LOOKUP_POSTGRES_ENTITY_KEYS,
  createLookupPostgresRow,
  deleteLookupPostgresRow,
  getLookupPostgresRow,
  isLookupPostgresEntityKey,
  listLookupPostgresRows,
  updateLookupPostgresRow,
} from "../../../lib/postgres/lookup-postgres.service.js";
import {
  MEMBER_DATA_POSTGRES_ENTITY_KEYS,
  createMemberDataSchemaRow,
  deleteMemberDataSchemaRow,
  getMemberDataSchemaRow,
  isMemberDataPostgresEntityKey,
  listMemberDataSchemaRows,
  updateMemberDataSchemaRow,
} from "../../../lib/postgres/member-data-postgres.service.js";
import {
  createTaskPg,
  deleteTaskPg,
  getTaskPg,
  listTasksPg,
  updateTaskPg,
} from "../../../lib/postgres/tasks-postgres.service.js";
import {
  deleteAssignmentPg,
  getAssignmentByIdPg,
  getTaskAssignmentsPg,
  listAllAssignmentsPg,
  updateAssignmentPg,
  upsertAssignmentPg,
} from "../../../lib/postgres/task-assignments-postgres.service.js";
import { publishChange } from "../../realtime/change-bus.js";

export const POSTGRES_ENTITY_KEYS = new Set([
  "time-entries",
  "timesheets",
  "tasks",
  "task-assignments",
  ...LOOKUP_POSTGRES_ENTITY_KEYS,
  ...MEMBER_DATA_POSTGRES_ENTITY_KEYS,
]);

/** Route entity CRUD to Postgres when configured and schema is ready. */
export async function shouldRouteEntityToPostgres(entityKey) {
  if (!POSTGRES_ENTITY_KEYS.has(entityKey)) return false;
  if (isMemberDataPostgresEntityKey(entityKey)) return isPostgresMemberDataReady();
  if (isLookupPostgresEntityKey(entityKey)) return isPostgresLookupReady();
  return isPostgresConfigured();
}

const TIME_ENTRY_COLUMNS = [
  "id",
  "member_id",
  "project_id",
  "task_id",
  "date",
  "start_time",
  "end_time",
  "duration",
  "description",
  "billable",
  "status",
  "source",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
];

const TIMESHEET_COLUMNS = [
  "id",
  "member_id",
  "period_start",
  "period_end",
  "status",
  "total_hours",
  "billable_hours",
  "submitted_at",
  "approved_at",
  "approved_by",
  "created_at",
  "updated_at",
];

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function normalizePgRow(row) {
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) {
      if (key === "date" || key === "period_start" || key === "period_end") {
        out[key] = value.toISOString().slice(0, 10);
      } else if (key === "start_time" || key === "end_time") {
        out[key] = value.toISOString().slice(11, 19);
      } else {
        out[key] = value.toISOString();
      }
    }
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== key) out[camel] = out[key];
  }
  return out;
}

/**
 * @param {string} entityKey
 * @param {URL} url
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function listPostgresRows(entityKey, url) {
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return listMemberDataSchemaRows(entityKey, url);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return listLookupPostgresRows(entityKey, url);
  }
  if (entityKey === "tasks") {
    return listTasksPg({
      projectId: url.searchParams.get("project_id") ?? url.searchParams.get("projectId") ?? undefined,
      teamId: url.searchParams.get("team_id") ?? url.searchParams.get("teamId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      assignedTo: url.searchParams.get("assigned_to") ?? url.searchParams.get("assignedTo") ?? undefined,
    });
  }
  if (entityKey === "task-assignments") {
    const taskId = url.searchParams.get("task_id") ?? url.searchParams.get("taskId");
    if (taskId) return getTaskAssignmentsPg(taskId);
    const memberId = url.searchParams.get("member_id") ?? url.searchParams.get("memberId");
    const rows = await listAllAssignmentsPg();
    return memberId ? rows.filter((row) => row.member_id === memberId) : rows;
  }
  if (entityKey === "time-entries") {
    const conditions = [];
    const params = [];
    for (const field of TIME_ENTRY_COLUMNS) {
      const value = url.searchParams.get(field) ?? url.searchParams.get(field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
      if (value !== null && value !== "") {
        params.push(value);
        conditions.push(`${field} = $${params.length}`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(
      `SELECT ${TIME_ENTRY_COLUMNS.join(", ")} FROM time_entries ${where} ORDER BY date DESC, created_at DESC LIMIT 200`,
      params,
    );
    return rows.map(normalizePgRow);
  }

  const conditions = [];
  const params = [];
  for (const field of TIMESHEET_COLUMNS) {
    const value = url.searchParams.get(field) ?? url.searchParams.get(field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    if (value !== null && value !== "") {
      params.push(value);
      conditions.push(`${field} = $${params.length}`);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query(
    `SELECT ${TIMESHEET_COLUMNS.join(", ")} FROM timesheets ${where} ORDER BY period_start DESC LIMIT 200`,
    params,
  );
  return rows.map(normalizePgRow);
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function getPostgresRow(entityKey, id) {
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return getMemberDataSchemaRow(entityKey, id);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return getLookupPostgresRow(entityKey, id);
  }
  if (entityKey === "tasks") {
    return getTaskPg(id);
  }
  if (entityKey === "task-assignments") {
    return getAssignmentByIdPg(id);
  }
  const table = entityKey === "time-entries" ? "time_entries" : "timesheets";
  const columns = entityKey === "time-entries" ? TIME_ENTRY_COLUMNS : TIMESHEET_COLUMNS;
  const rows = await query(`SELECT ${columns.join(", ")} FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalizePgRow(rows[0]) : null;
}

/**
 * @param {string} entityKey
 * @param {Record<string, unknown>} payload
 */
export async function createPostgresRow(entityKey, payload) {
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return createMemberDataSchemaRow(entityKey, payload);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return createLookupPostgresRow(entityKey, payload);
  }
  if (entityKey === "tasks") {
    return createTaskPg(payload);
  }
  if (entityKey === "task-assignments") {
    return upsertAssignmentPg(payload);
  }
  if (entityKey === "time-entries") {
    // This is the only writer time_entries has - every row created here comes from the
    // Manual Time form, not from the agent/timer, so 'manual' is a fact, not a default guess.
    const rows = await query(
      `INSERT INTO time_entries
        (id, member_id, project_id, task_id, date, start_time, end_time, duration, description, billable, status, source, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${TIME_ENTRY_COLUMNS.join(", ")}`,
      [
        payload.id,
        payload.member_id,
        payload.project_id,
        payload.task_id ?? null,
        payload.date,
        payload.start_time ?? null,
        payload.end_time ?? null,
        payload.duration ?? 0,
        payload.description ?? null,
        payload.billable ?? false,
        payload.status ?? "pending",
        "manual",
        payload.created_by ?? null,
        payload.updated_by ?? null,
      ],
    );
    void publishChange("timesheets", rows[0]?.id, "created", payload.created_by ?? undefined);
    return normalizePgRow(rows[0]);
  }

  let totalHours = payload.total_hours ?? null;
  let billableHours = payload.billable_hours ?? null;
  if (payload.status === "submitted" && payload.member_id && payload.period_start && payload.period_end) {
    const summary = await computeTimesheetHours(payload.member_id, payload.period_start, payload.period_end);
    totalHours = summary.total_hours;
    billableHours = summary.billable_hours;
  }

  const rows = await query(
    `INSERT INTO timesheets
      (id, member_id, period_start, period_end, status, total_hours, billable_hours, submitted_at, approved_at, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${TIMESHEET_COLUMNS.join(", ")}`,
    [
      payload.id,
      payload.member_id,
      payload.period_start,
      payload.period_end,
      payload.status ?? "draft",
      totalHours,
      billableHours,
      payload.submitted_at ?? (payload.status === "submitted" ? new Date() : null),
      payload.approved_at ?? null,
      payload.approved_by ?? null,
    ],
  );
  void publishChange("timesheets", rows[0]?.id, "created", payload.created_by ?? undefined);
  return normalizePgRow(rows[0]);
}

/**
 * @param {string} entityKey
 * @param {string} id
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} existing
 */
export async function updatePostgresRow(entityKey, id, payload, existing) {
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return updateMemberDataSchemaRow(entityKey, id, payload, existing);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return updateLookupPostgresRow(entityKey, id, payload, existing);
  }
  if (entityKey === "tasks") {
    return updateTaskPg(id, payload);
  }
  if (entityKey === "task-assignments") {
    return updateAssignmentPg(id, payload);
  }
  if (entityKey === "time-entries") {
    const merged = { ...existing, ...payload, id };
    const rows = await query(
      `UPDATE time_entries SET
        member_id = $2, project_id = $3, task_id = $4, date = $5, start_time = $6, end_time = $7,
        duration = $8, description = $9, billable = $10, status = $11, updated_by = $12
       WHERE id = $1
       RETURNING ${TIME_ENTRY_COLUMNS.join(", ")}`,
      [
        id,
        merged.member_id,
        merged.project_id,
        merged.task_id ?? null,
        merged.date,
        merged.start_time ?? null,
        merged.end_time ?? null,
        merged.duration ?? 0,
        merged.description ?? null,
        merged.billable ?? false,
        merged.status ?? "pending",
        merged.updated_by ?? null,
      ],
    );
    void publishChange("timesheets", id, "updated", merged.updated_by ?? undefined);
    return normalizePgRow(rows[0]);
  }

  const merged = { ...existing, ...payload, id };
  if (merged.status === "submitted" && merged.member_id && merged.period_start && merged.period_end) {
    const summary = await computeTimesheetHours(merged.member_id, merged.period_start, merged.period_end);
    merged.total_hours = summary.total_hours;
    merged.billable_hours = summary.billable_hours;
    if (!merged.submitted_at) merged.submitted_at = new Date();
  }

  const rows = await query(
    `UPDATE timesheets SET
      member_id = $2, period_start = $3, period_end = $4, status = $5,
      total_hours = $6, billable_hours = $7, submitted_at = $8, approved_at = $9, approved_by = $10
     WHERE id = $1
     RETURNING ${TIMESHEET_COLUMNS.join(", ")}`,
    [
      id,
      merged.member_id,
      merged.period_start,
      merged.period_end,
      merged.status ?? "draft",
      merged.total_hours ?? null,
      merged.billable_hours ?? null,
      merged.submitted_at ?? null,
      merged.approved_at ?? null,
      merged.approved_by ?? null,
    ],
  );
  void publishChange("timesheets", id, "updated", merged.updated_by ?? undefined);
  return normalizePgRow(rows[0]);
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function deletePostgresRow(entityKey, id) {
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return deleteMemberDataSchemaRow(entityKey, id);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return deleteLookupPostgresRow(entityKey, id);
  }
  if (entityKey === "tasks") {
    return deleteTaskPg(id);
  }
  if (entityKey === "task-assignments") {
    return deleteAssignmentPg(id);
  }
  const table = entityKey === "time-entries" ? "time_entries" : "timesheets";
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  void publishChange("timesheets", id, "deleted");
}

/**
 * @param {string} memberId
 * @param {string} periodStart
 * @param {string} periodEnd
 */
export async function computeTimesheetHours(memberId, periodStart, periodEnd) {
  const [summary] = await query(
    `SELECT
      COALESCE(SUM(duration), 0) / 3600.0 AS total_hours,
      COALESCE(SUM(CASE WHEN billable THEN duration ELSE 0 END), 0) / 3600.0 AS billable_hours
    FROM time_entries
    WHERE member_id = $1 AND date BETWEEN $2 AND $3 AND status != 'rejected'`,
    [memberId, periodStart, periodEnd],
  );
  return {
    total_hours: Number(summary?.total_hours ?? 0),
    billable_hours: Number(summary?.billable_hours ?? 0),
  };
}

/**
 * @param {string} weekStartKey - ISO date string YYYY-MM-DD
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function fetchTimeEntriesSinceDate(weekStartKey) {
  const rows = await query(
    `SELECT member_id, project_id, date, duration, billable
     FROM time_entries
     WHERE date >= $1
     ORDER BY date DESC
     LIMIT 2000`,
    [weekStartKey],
  );
  return rows.map(normalizePgRow);
}

/**
 * @param {string} projectId
 * @param {Date} periodStart
 * @param {Date | null} periodEnd
 */
export async function sumBillableHoursForProjectInPeriod(projectId, periodStart, periodEnd) {
  const rows = await query(
    `SELECT date, duration, billable
     FROM time_entries
     WHERE project_id = $1 AND billable = true
     LIMIT 2000`,
    [projectId],
  );
  let totalSeconds = 0;
  for (const row of rows) {
    const dateStr = String(row.date ?? "");
    const entryDate = dateStr ? new Date(`${dateStr}T00:00:00Z`) : null;
    if (!entryDate || Number.isNaN(entryDate.getTime())) continue;
    if (entryDate < periodStart) continue;
    if (periodEnd && entryDate >= periodEnd) continue;
    totalSeconds += typeof row.duration === "number" ? row.duration : 0;
  }
  return totalSeconds / 3600;
}
