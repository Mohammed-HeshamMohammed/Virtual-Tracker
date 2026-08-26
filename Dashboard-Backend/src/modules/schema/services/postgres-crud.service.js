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
import {
  createProjectPg,
  getProjectPg,
  updateProjectPg,
  deleteProjectPg,
  listProjectsPg,
  addProjectMemberPg,
  removeProjectMemberPg,
  listProjectMembersPg,
  getProjectBudgetPg,
  getAllProjectBudgetsPg,
  upsertProjectBudgetPg,
  listProjectMemberLimitsPg,
  getAllProjectMemberLimitsPg,
  upsertProjectMemberLimitPg,
  linkClientProjectPg,
  unlinkClientProjectPg,
  listClientIdsForProjectPg,
  listProjectIdsForClientPg,
  linkTeamProjectPg,
  unlinkTeamProjectPg,
  listTeamIdsForProjectPg,
  listProjectIdsForTeamPg,
} from "../../../lib/postgres/projects-postgres.service.js";
import {
  getClientPg,
  listClientsPg,
  createClientPg,
  updateClientPg,
  deleteClientPg,
  getClientBudgetPg,
  getAllClientBudgetsPg,
  upsertClientBudgetPg,
  getClientInvoicingPg,
  upsertClientInvoicingPg,
} from "../../../lib/postgres/clients-postgres.service.js";
import {
  createTeamPg,
  getTeamByIdPg,
  listTeamsPg,
  updateTeamPg,
  deleteTeamPg,
  listTeamMembersPg,
  listAllTeamMembersPg,
  addTeamMemberPg,
  removeTeamMemberPg,
} from "../../../lib/postgres/teams-postgres.service.js";
import {
  createMemberPg,
  getMemberByIdPg,
  listMembersPg,
  updateMemberPg,
  deleteMemberPg,
} from "../../../lib/postgres/members-postgres.service.js";
import { publishChange } from "../../realtime/change-bus.js";

export const POSTGRES_ENTITY_KEYS = new Set([
  "time-entries",
  "timesheets",
  "tasks",
  "task-assignments",
  "task-comments",
  "task-subtasks",
  "task-attachments",
  "task-hours",
  "projects",
  "project-members",
  "project-budgets",
  "project-member-limits",
  "client-projects",
  "team-projects",
  "clients",
  "client-budgets",
  "client-invoicing",
  "teams",
  "team-members",
  "members",
  "member-bans",
  "invites",
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

/** One config per task child entity - simple enough (a handful of columns,
 * no cross-table business logic like timesheets' hours computation) that one
 * generic column-driven implementation covers all four, instead of four
 * near-identical hand-written branches the way every other entity above does
 * it. task_id is intentionally excluded from `columns` for UPDATE - it's
 * set once at creation and never reassigned. */
const TASK_CHILD_TABLES = {
  "task-comments": { table: "task_comments", columns: ["id", "task_id", "body", "created_at", "created_by", "updated_by"] },
  "task-subtasks": { table: "task_subtasks", columns: ["id", "task_id", "title", "completed", "order_index", "created_at", "created_by", "updated_by"] },
  "task-attachments": { table: "task_attachments", columns: ["id", "task_id", "file_url", "file_name", "uploaded_at", "uploaded_by"] },
  "task-hours": { table: "task_hours", columns: ["id", "task_id", "user_id", "hours_spent", "status", "submitted_at", "created_at", "updated_at", "created_by", "updated_by"] },
};

function isTaskChildPostgresEntityKey(entityKey) {
  return Object.prototype.hasOwnProperty.call(TASK_CHILD_TABLES, entityKey);
}

async function listTaskChildRowsPg(entityKey, url) {
  const { table, columns } = TASK_CHILD_TABLES[entityKey];
  const taskId = url.searchParams.get("task_id") ?? url.searchParams.get("taskId");
  const rows = taskId
    ? await query(`SELECT ${columns.join(", ")} FROM ${table} WHERE task_id = $1 ORDER BY created_at ASC LIMIT 500`, [taskId])
    : await query(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY created_at DESC LIMIT 500`);
  return rows.map(normalizePgRow);
}

async function getTaskChildRowPg(entityKey, id) {
  const { table, columns } = TASK_CHILD_TABLES[entityKey];
  const rows = await query(`SELECT ${columns.join(", ")} FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalizePgRow(rows[0]) : null;
}

async function createTaskChildRowPg(entityKey, payload) {
  const { table, columns } = TASK_CHILD_TABLES[entityKey];
  // Only columns actually present in payload are inserted, so an omitted
  // field (e.g. "completed" on a new subtask) falls through to the table's
  // own DEFAULT instead of this call having to know or repeat it.
  const cols = columns.filter((c) => payload[c] !== undefined);
  const rows = await query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${columns.join(", ")}`,
    cols.map((c) => payload[c]),
  );
  return normalizePgRow(rows[0]);
}

async function updateTaskChildRowPg(entityKey, id, payload, existing) {
  const { table, columns } = TASK_CHILD_TABLES[entityKey];
  const merged = { ...existing, ...payload, id };
  const writable = columns.filter((c) => c !== "id" && c !== "task_id");
  const rows = await query(
    `UPDATE ${table} SET ${writable.map((c, i) => `${c} = $${i + 2}`).join(", ")}
     WHERE id = $1 RETURNING ${columns.join(", ")}`,
    [id, ...writable.map((c) => merged[c] ?? null)],
  );
  return normalizePgRow(rows[0]);
}

async function deleteTaskChildRowPg(entityKey, id) {
  const { table } = TASK_CHILD_TABLES[entityKey];
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

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
  if (isTaskChildPostgresEntityKey(entityKey)) {
    return listTaskChildRowsPg(entityKey, url);
  }
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
  if (entityKey === "projects") {
    const status = url.searchParams.get("status") ?? undefined;
    const rows = await listProjectsPg({ status });
    return rows.map(normalizePgRow);
  }
  if (entityKey === "project-members") {
    const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
    const rows = projectId ? await listProjectMembersPg(projectId) : await query("SELECT * FROM project_members LIMIT 5000");
    return rows.map(normalizePgRow);
  }
  if (entityKey === "project-budgets") {
    const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
    if (projectId) {
      const budget = await getProjectBudgetPg(projectId);
      return budget ? [normalizePgRow(budget)] : [];
    }
    const rows = await getAllProjectBudgetsPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "project-member-limits") {
    const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
    const rows = projectId ? await listProjectMemberLimitsPg(projectId) : await getAllProjectMemberLimitsPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "client-projects") {
    const clientId = url.searchParams.get("client_id") ?? url.searchParams.get("clientId");
    const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
    if (clientId) {
      const pids = await listProjectIdsForClientPg(clientId);
      return pids.map((pid) => normalizePgRow({ client_id: clientId, project_id: pid }));
    }
    if (projectId) {
      const cids = await listClientIdsForProjectPg(projectId);
      return cids.map((cid) => normalizePgRow({ client_id: cid, project_id: projectId }));
    }
    const rows = await query("SELECT * FROM client_projects LIMIT 5000");
    return rows.map(normalizePgRow);
  }
  if (entityKey === "team-projects") {
    const teamId = url.searchParams.get("team_id") ?? url.searchParams.get("teamId");
    const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
    if (teamId) {
      const pids = await listProjectIdsForTeamPg(teamId);
      return pids.map((pid) => normalizePgRow({ team_id: teamId, project_id: pid }));
    }
    if (projectId) {
      const tids = await listTeamIdsForProjectPg(projectId);
      return tids.map((tid) => normalizePgRow({ team_id: tid, project_id: projectId }));
    }
    const rows = await query("SELECT * FROM team_projects LIMIT 5000");
    return rows.map(normalizePgRow);
  }
  if (entityKey === "clients") {
    const rows = await listClientsPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "client-budgets") {
    const clientId = url.searchParams.get("client_id") ?? url.searchParams.get("clientId");
    if (clientId) {
      const budget = await getClientBudgetPg(clientId);
      return budget ? [normalizePgRow(budget)] : [];
    }
    const rows = await getAllClientBudgetsPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "client-invoicing") {
    const clientId = url.searchParams.get("client_id") ?? url.searchParams.get("clientId");
    if (clientId) {
      const invoicing = await getClientInvoicingPg(clientId);
      return invoicing ? [normalizePgRow(invoicing)] : [];
    }
    const rows = await query("SELECT * FROM client_invoicing LIMIT 2000");
    return rows.map(normalizePgRow);
  }
  if (entityKey === "teams") {
    const rows = await listTeamsPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "team-members") {
    const teamId = url.searchParams.get("team_id") ?? url.searchParams.get("teamId");
    const rows = teamId ? await listTeamMembersPg(teamId) : await listAllTeamMembersPg();
    return rows.map(normalizePgRow);
  }
  if (entityKey === "members") {
    const status = url.searchParams.get("status") ?? undefined;
    const rows = await listMembersPg({ status });
    return rows.map(normalizePgRow);
  }
  if (entityKey === "member-bans") {
    const rows = await query("SELECT * FROM member_bans WHERE active = true ORDER BY banned_at DESC LIMIT 200");
    return rows.map(normalizePgRow);
  }
  if (entityKey === "invites") {
    const rows = await query("SELECT * FROM invites ORDER BY sent_at DESC NULLS LAST LIMIT 200");
    return rows.map(normalizePgRow);
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
  if (isTaskChildPostgresEntityKey(entityKey)) {
    return getTaskChildRowPg(entityKey, id);
  }
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
  if (entityKey === "projects") {
    const row = await getProjectPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "project-members") {
    const rows = await query("SELECT * FROM project_members WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "project-budgets") {
    const rows = await query("SELECT * FROM project_budgets WHERE id = $1 OR project_id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "project-member-limits") {
    const rows = await query("SELECT * FROM project_member_limits WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "client-projects") {
    const rows = await query("SELECT * FROM client_projects WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "team-projects") {
    const rows = await query("SELECT * FROM team_projects WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "clients") {
    const row = await getClientPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "client-budgets") {
    const row = await getClientBudgetPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "client-invoicing") {
    const row = await getClientInvoicingPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "teams") {
    const row = await getTeamByIdPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "team-members") {
    const rows = await query("SELECT * FROM team_members WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "members") {
    const row = await getMemberByIdPg(id);
    return row ? normalizePgRow(row) : null;
  }
  if (entityKey === "member-bans") {
    const rows = await query("SELECT * FROM member_bans WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
  }
  if (entityKey === "invites") {
    const rows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizePgRow(rows[0]) : null;
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
  if (isTaskChildPostgresEntityKey(entityKey)) {
    return createTaskChildRowPg(entityKey, payload);
  }
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
  if (entityKey === "projects") {
    const created = await createProjectPg(payload);
    return normalizePgRow(created);
  }
  if (entityKey === "project-members") {
    const created = await addProjectMemberPg(
      payload.project_id ?? payload.projectId,
      payload.member_id ?? payload.memberId,
      { role: payload.project_role ?? payload.projectRole, actorId: payload.assigned_by ?? payload.assignedBy }
    );
    return normalizePgRow(created);
  }
  if (entityKey === "project-budgets") {
    const created = await upsertProjectBudgetPg(
      payload.project_id ?? payload.projectId,
      payload,
      payload.created_by ?? payload.createdBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "project-member-limits") {
    const created = await upsertProjectMemberLimitPg(
      payload.project_id ?? payload.projectId,
      payload.member_id ?? payload.memberId,
      payload,
      payload.created_by ?? payload.createdBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "client-projects") {
    const created = await linkClientProjectPg(
      payload.client_id ?? payload.clientId,
      payload.project_id ?? payload.projectId,
      payload.assigned_by ?? payload.assignedBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "team-projects") {
    const created = await linkTeamProjectPg(
      payload.team_id ?? payload.teamId,
      payload.project_id ?? payload.projectId,
      payload.assigned_by ?? payload.assignedBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "clients") {
    const created = await createClientPg(payload);
    return normalizePgRow(created);
  }
  if (entityKey === "client-budgets") {
    const created = await upsertClientBudgetPg(
      payload.client_id ?? payload.clientId,
      payload,
      payload.created_by ?? payload.createdBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "client-invoicing") {
    const created = await upsertClientInvoicingPg(
      payload.client_id ?? payload.clientId,
      payload,
      payload.created_by ?? payload.createdBy
    );
    return normalizePgRow(created);
  }
  if (entityKey === "teams") {
    const created = await createTeamPg(payload);
    return normalizePgRow(created);
  }
  if (entityKey === "team-members") {
    const created = await addTeamMemberPg(payload);
    return normalizePgRow(created);
  }
  if (entityKey === "members") {
    const created = await createMemberPg(payload);
    return normalizePgRow(created);
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
export async function updatePostgresRow(entityKey, id, payload, existing, expectedUpdatedAt) {
  if (isTaskChildPostgresEntityKey(entityKey)) {
    return updateTaskChildRowPg(entityKey, id, payload, existing);
  }
  if (isMemberDataPostgresEntityKey(entityKey)) {
    return updateMemberDataSchemaRow(entityKey, id, payload, existing);
  }
  if (isLookupPostgresEntityKey(entityKey)) {
    return updateLookupPostgresRow(entityKey, id, payload, existing);
  }
  if (entityKey === "tasks") {
    return updateTaskPg(id, payload, expectedUpdatedAt);
  }
  if (entityKey === "task-assignments") {
    return updateAssignmentPg(id, payload);
  }
  if (entityKey === "projects") {
    const updated = await updateProjectPg(id, payload, expectedUpdatedAt);
    if (updated && typeof updated === "object" && "conflict" in updated) return updated;
    return normalizePgRow(updated);
  }
  if (entityKey === "clients") {
    const updated = await updateClientPg(id, payload, expectedUpdatedAt);
    if (updated && typeof updated === "object" && "conflict" in updated) return updated;
    return normalizePgRow(updated);
  }
  if (entityKey === "teams") {
    const updated = await updateTeamPg(id, payload);
    return normalizePgRow(updated);
  }
  if (entityKey === "members") {
    const updated = await updateMemberPg(id, payload);
    return normalizePgRow(updated);
  }
  if (entityKey === "project-budgets") {
    const updated = await upsertProjectBudgetPg(
      payload.project_id ?? existing.project_id,
      { ...existing, ...payload },
      payload.updated_by ?? payload.updatedBy,
      expectedUpdatedAt
    );
    if (updated && typeof updated === "object" && "conflict" in updated) return updated;
    return normalizePgRow(updated);
  }
  if (entityKey === "client-budgets") {
    const updated = await upsertClientBudgetPg(
      payload.client_id ?? existing.client_id,
      { ...existing, ...payload },
      payload.updated_by ?? payload.updatedBy
    );
    return normalizePgRow(updated);
  }
  if (entityKey === "client-invoicing") {
    const updated = await upsertClientInvoicingPg(
      payload.client_id ?? existing.client_id,
      { ...existing, ...payload },
      payload.updated_by ?? payload.updatedBy
    );
    return normalizePgRow(updated);
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
  if (isTaskChildPostgresEntityKey(entityKey)) {
    return deleteTaskChildRowPg(entityKey, id);
  }
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
  if (entityKey === "projects") {
    return deleteProjectPg(id);
  }
  if (entityKey === "clients") {
    return deleteClientPg(id);
  }
  if (entityKey === "teams") {
    return deleteTeamPg(id);
  }
  if (entityKey === "members") {
    return deleteMemberPg(id);
  }
  if (entityKey === "project-members") {
    const rows = await query("SELECT * FROM project_members WHERE id = $1 LIMIT 1", [id]);
    if (rows[0]) await removeProjectMemberPg(rows[0].project_id, rows[0].member_id);
    return;
  }
  if (entityKey === "project-budgets") {
    await query("DELETE FROM project_budgets WHERE id = $1 OR project_id = $1", [id]);
    return;
  }
  if (entityKey === "client-projects") {
    const rows = await query("SELECT * FROM client_projects WHERE id = $1 LIMIT 1", [id]);
    if (rows[0]) await unlinkClientProjectPg(rows[0].client_id, rows[0].project_id);
    return;
  }
  if (entityKey === "team-members") {
    const rows = await query("SELECT * FROM team_members WHERE id = $1 LIMIT 1", [id]);
    if (rows[0]) await removeTeamMemberPg(rows[0].team_id, rows[0].member_id);
    return;
  }
  if (entityKey === "team-projects") {
    const rows = await query("SELECT * FROM team_projects WHERE id = $1 LIMIT 1", [id]);
    if (rows[0]) await unlinkTeamProjectPg(rows[0].team_id, rows[0].project_id);
    return;
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
/**
 * Hours for a member's pay period.
 *
 * Unions the two places worked time actually lands, the same way
 * getProjectTrackedSecondsPg does: manual `time_entries` rows, and time the
 * agent/web tracker recorded as `activity_sessions`. Reading only time_entries
 * (as this did) reports 0 for anyone who tracks their time instead of typing
 * it in - which is every member using the tracker, so every submitted
 * timesheet came out empty.
 *
 * `duration` on time_entries is SECONDS, matching activity_sessions'
 * active_seconds and every other reader in this codebase.
 *
 * Tracked session time counts as billable: it is time worked against a
 * project, and sessions carry no billable flag of their own. Manual entries
 * keep their explicit flag.
 */
export async function computeTimesheetHours(memberId, periodStart, periodEnd) {
  const [summary] = await query(
    `WITH worked AS (
       SELECT duration AS seconds, billable
       FROM time_entries
       WHERE member_id = $1 AND date BETWEEN $2 AND $3 AND status != 'rejected'
       UNION ALL
       SELECT active_seconds AS seconds, true AS billable
       FROM activity_sessions
       WHERE member_id = $1 AND started_at::date BETWEEN $2 AND $3
     )
     SELECT
       COALESCE(SUM(seconds), 0) / 3600.0 AS total_hours,
       COALESCE(SUM(CASE WHEN billable THEN seconds ELSE 0 END), 0) / 3600.0 AS billable_hours
     FROM worked`,
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
