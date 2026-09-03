
import crypto from "node:crypto";
import { query } from "./client.js";
import { getSingleByMemberId } from "./member-data-store.js";
import { getClientBudgetPg } from "./clients-postgres.service.js";
import { publishChange } from "../../modules/realtime/change-bus.js";
import { syncManagementParentsOfProject } from "../../modules/projects/management-rollup.service.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function dateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

export function toDayStrOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}


export async function createProjectPg(data) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO projects (
       id, name, status, billable, disable_activity, allow_project_tracking, disable_idle_time,
       idle_time_seconds, client_id, managers_notes, users_notes, viewers_notes, type, end_date,
       require_task_to_track, restrict_task_creation, require_stop_note, client_can_manage, client_can_track,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
     RETURNING *`,
    [
      id,
      data.name,
      data.status ?? "active",
      data.billable ?? true,
      data.disableActivity ?? false,
      data.allowProjectTracking ?? true,
      data.disableIdleTime ?? false,
      Number.isFinite(data.idleTimeSeconds) ? Math.max(0, Math.floor(data.idleTimeSeconds)) : 450,
      uuidOrNull(data.clientId),
      data.managersNotes ?? null,
      data.usersNotes ?? null,
      data.viewersNotes ?? null,
      data.type ?? "normal",
      dateOrNull(data.endDate),
      data.requireTaskToTrack ?? true,
      data.restrictTaskCreation ?? true,
      data.requireStopNote ?? false,
      data.clientCanManage === true,
      data.clientCanTrack === true,
      uuidOrNull(data.createdBy),
    ],
  );
  const project = rows[0] ?? null;
  if (project) void publishChange("projects", id, "created", uuidOrNull(data.createdBy) ?? undefined);
  return project;
}

export async function getProjectPg(id) {
  const rows = await query("SELECT * FROM projects WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function updateProjectPg(id, patch, expectedUpdatedAt) {
  const columns = {
    name: "name",
    status: "status",
    billable: "billable",
    disableActivity: "disable_activity",
    allowProjectTracking: "allow_project_tracking",
    disableIdleTime: "disable_idle_time",
    idleTimeSeconds: "idle_time_seconds",
    clientId: "client_id",
    managersNotes: "managers_notes",
    usersNotes: "users_notes",
    viewersNotes: "viewers_notes",
    endDate: "end_date",
    requireTaskToTrack: "require_task_to_track",
    restrictTaskCreation: "restrict_task_creation",
    requireStopNote: "require_stop_note",
    clientCanManage: "client_can_manage",
    clientCanTrack: "client_can_track",
    updatedBy: "updated_by",
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push(
      key === "clientId"
        ? uuidOrNull(patch[key])
        : key === "endDate"
          ? dateOrNull(patch[key])
          : key === "idleTimeSeconds"
            ? Math.max(0, Math.floor(Number(patch[key]) || 0))
            : key === "clientCanManage" || key === "clientCanTrack"
              ? patch[key] === true
              : patch[key],
    );
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getProjectPg(id);
  sets.push("updated_at = now()");
  const where = expectedUpdatedAt
    ? `WHERE id = $1 AND date_trunc('milliseconds', updated_at) = $${params.push(expectedUpdatedAt)}::timestamptz`
    : "WHERE id = $1";
  const rows = await query(`UPDATE projects SET ${sets.join(", ")} ${where} RETURNING *`, params);
  if (rows.length === 0 && expectedUpdatedAt) {
    return { conflict: true, current: await getProjectPg(id) };
  }
  const project = rows[0] ?? null;
  if (project) void publishChange("projects", id, "updated", uuidOrNull(patch.updatedBy) ?? undefined);
  return project;
}

export async function archiveProjectPg(id, actorId, expectedUpdatedAt) {
  const params = [id, uuidOrNull(actorId)];
  const where = expectedUpdatedAt
    ? `WHERE id = $1 AND date_trunc('milliseconds', updated_at) = $${params.push(expectedUpdatedAt)}::timestamptz`
    : "WHERE id = $1";
  const rows = await query(
    `UPDATE projects SET status = 'archived', archived_by = $2, archived_at = now(), updated_at = now() ${where} RETURNING *`,
    params,
  );
  if (rows.length === 0 && expectedUpdatedAt) {
    return { conflict: true, current: await getProjectPg(id) };
  }
  const project = rows[0] ?? null;
  if (project) void publishChange("projects", id, "updated", uuidOrNull(actorId) ?? undefined);
  return project;
}

export async function deleteProjectPg(id, actorId) {
  const sessions = await query("SELECT id FROM activity_sessions WHERE project_id = $1", [id]);
  const sessionIds = sessions.map((row) => String(row.id));
  if (sessionIds.length > 0) {
    await Promise.all([
      query("DELETE FROM activity_screenshots WHERE session_id = ANY($1::text[])", [sessionIds]),
      query("DELETE FROM activity_app_logs WHERE session_id = ANY($1::text[])", [sessionIds]),
      query("DELETE FROM activity_url_logs WHERE session_id = ANY($1::text[])", [sessionIds]),
    ]);
  }
  await query("DELETE FROM projects WHERE id = $1", [id]);
  void publishChange("projects", id, "deleted", uuidOrNull(actorId) ?? undefined);
}

export async function listProjectsPg(options = {}) {
  const limit = Math.min(Math.max(options.limit ?? 300, 1), 1000);
  if (options.status) {
    return query("SELECT * FROM projects WHERE status = $1 ORDER BY updated_at DESC LIMIT $2", [
      options.status,
      limit,
    ]);
  }
  return query("SELECT * FROM projects ORDER BY updated_at DESC LIMIT $1", [limit]);
}


export async function addProjectMemberPg(projectId, memberId, options = {}) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO project_members (id, project_id, member_id, project_role, source, assigned_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (project_id, member_id) DO UPDATE SET project_role = EXCLUDED.project_role, updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [id, projectId, memberId, options.role ?? null, options.source ?? "manual", uuidOrNull(options.actorId)],
  );
  const row = rows[0] ?? null;
  if (row) void publishChange("project-members", projectId, "updated", uuidOrNull(options.actorId) ?? undefined);
  void syncManagementParentsOfProject(projectId, uuidOrNull(options.actorId));
  return row;
}

export async function removeProjectMemberPg(projectId, memberId, actorId) {
  await query("DELETE FROM project_members WHERE project_id = $1 AND member_id = $2", [projectId, memberId]);
  void publishChange("project-members", projectId, "updated", uuidOrNull(actorId) ?? undefined);
  void syncManagementParentsOfProject(projectId, uuidOrNull(actorId));
}

export async function listProjectMembersPg(projectId) {
  return query("SELECT * FROM project_members WHERE project_id = $1", [projectId]);
}

export async function listProjectIdsForMemberPg(memberId) {
  const rows = await query("SELECT project_id FROM project_members WHERE member_id = $1 LIMIT 200", [memberId]);
  return rows.map((r) => r.project_id);
}

export async function listViewerProjectIdsPg(memberId) {
  if (!memberId) return [];
  const rows = await query(
    `SELECT project_id FROM project_members WHERE member_id = $1
     UNION
     SELECT id AS project_id FROM projects WHERE created_by = $1
     UNION
     SELECT cp.project_id
     FROM client_projects cp
     JOIN clients c ON c.id = cp.client_id
     WHERE c.member_id = $1
     LIMIT 500`,
    [memberId],
  );
  return rows.map((r) => String(r.project_id)).filter(Boolean);
}

export async function listClientManagedProjectIdsPg(memberId) {
  if (!memberId) return new Set();
  const rows = await query(
    `SELECT cp.project_id
     FROM client_projects cp
     JOIN clients c ON c.id = cp.client_id
     JOIN projects p ON p.id = cp.project_id
     WHERE c.member_id = $1 AND p.client_can_manage = true`,
    [memberId],
  );
  return new Set(rows.map((r) => String(r.project_id)));
}

export async function listClientTrackableProjectIdsPg(memberId) {
  if (!memberId) return new Set();
  const rows = await query(
    `SELECT cp.project_id
     FROM client_projects cp
     JOIN clients c ON c.id = cp.client_id
     JOIN projects p ON p.id = cp.project_id
     WHERE c.member_id = $1 AND p.client_can_track = true`,
    [memberId],
  );
  return new Set(rows.map((r) => String(r.project_id)));
}

export async function listMemberIdsForProjectsPg(projectIds) {
  if (!projectIds.length) return [];
  const rows = await query("SELECT DISTINCT member_id FROM project_members WHERE project_id = ANY($1::uuid[])", [
    projectIds,
  ]);
  return rows.map((r) => r.member_id);
}

export async function countMembersByProjectPg() {
  const rows = await query("SELECT project_id, COUNT(*)::int AS count FROM project_members GROUP BY project_id");
  return new Map(rows.map((r) => [r.project_id, r.count]));
}


export async function getProjectBudgetPg(projectId) {
  const rows = await query("SELECT * FROM project_budgets WHERE project_id = $1 LIMIT 1", [projectId]);
  return rows[0] ?? null;
}

export async function getAllProjectBudgetsPg() {
  return query("SELECT * FROM project_budgets");
}

export async function upsertProjectBudgetPg(projectId, data, actorId, expectedUpdatedAt) {
  const existing = await getProjectBudgetPg(projectId);

  if (existing && expectedUpdatedAt) {
    const rows = await query(
      `UPDATE project_budgets SET
         type = $2, based_on = $3, scope = $4, cost = $5, notify_project_members = $6, notify_at_pct = $7,
         who_to_notify = $8, stop_timers_when_reached = $9, stop_timers_at_pct = $10, resets = $11,
         start_date = $12, include_non_billable_time = $13, updated_by = $14, updated_at = now(), end_date = $16
       WHERE project_id = $1 AND date_trunc('milliseconds', updated_at) = $15::timestamptz
       RETURNING *`,
      [
        projectId,
        data.type ?? "Cost based",
        data.basedOn ?? null,
        data.scope === "per_person" ? "per_person" : "per_project",
        data.cost ?? 0,
        data.notifyProjectMembers ?? false,
        data.notifyAtPct ?? null,
        data.whoToNotify ?? null,
        data.stopTimersWhenReached ?? false,
        data.stopTimersAtPct ?? null,
        data.resets ?? "Never",
        dateOrNull(data.startDate),
        data.includeNonBillableTime ?? true,
        uuidOrNull(actorId),
        expectedUpdatedAt,
        dateOrNull(data.endDate),
      ],
    );
    if (rows.length === 0) {
      return { conflict: true, current: await getProjectBudgetPg(projectId) };
    }
    const budget = rows[0];
    void publishChange("project-budgets", projectId, "updated", uuidOrNull(actorId) ?? undefined);
    return budget;
  }

  const id = existing?.id ?? crypto.randomUUID();
  const rows = await query(
    `INSERT INTO project_budgets (
       id, project_id, type, based_on, scope, cost, notify_project_members, notify_at_pct, who_to_notify,
       stop_timers_when_reached, stop_timers_at_pct, resets, start_date, include_non_billable_time,
       created_by, updated_by, end_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)
     ON CONFLICT (project_id) DO UPDATE SET
       type = EXCLUDED.type, based_on = EXCLUDED.based_on, scope = EXCLUDED.scope, cost = EXCLUDED.cost,
       notify_project_members = EXCLUDED.notify_project_members, notify_at_pct = EXCLUDED.notify_at_pct,
       who_to_notify = EXCLUDED.who_to_notify, stop_timers_when_reached = EXCLUDED.stop_timers_when_reached,
       stop_timers_at_pct = EXCLUDED.stop_timers_at_pct, resets = EXCLUDED.resets,
       start_date = EXCLUDED.start_date, include_non_billable_time = EXCLUDED.include_non_billable_time,
       updated_by = EXCLUDED.updated_by, updated_at = now(), end_date = EXCLUDED.end_date
     RETURNING *`,
    [
      id,
      projectId,
      data.type ?? "Cost based",
      data.basedOn ?? null,
      data.scope === "per_person" ? "per_person" : "per_project",
      data.cost ?? 0,
      data.notifyProjectMembers ?? false,
      data.notifyAtPct ?? null,
      data.whoToNotify ?? null,
      data.stopTimersWhenReached ?? false,
      data.stopTimersAtPct ?? null,
      data.resets ?? "Never",
      dateOrNull(data.startDate),
      data.includeNonBillableTime ?? true,
      uuidOrNull(actorId),
      dateOrNull(data.endDate),
    ],
  );
  const budget = rows[0] ?? null;
  if (budget) void publishChange("project-budgets", projectId, "updated", uuidOrNull(actorId) ?? undefined);
  return budget;
}


export async function getProjectMemberLimitPg(projectId, memberId) {
  const rows = await query(
    "SELECT * FROM project_member_limits WHERE project_id = $1 AND member_id = $2 LIMIT 1",
    [projectId, memberId],
  );
  return rows[0] ?? null;
}

export async function listProjectMemberLimitsPg(projectId) {
  return query("SELECT * FROM project_member_limits WHERE project_id = $1", [projectId]);
}

export async function getAllProjectMemberLimitsPg() {
  return query("SELECT * FROM project_member_limits");
}

export async function resolveMemberHourlyRatePg(db, projectId, memberId, basedOn) {
  if (String(basedOn || "").toLowerCase().includes("pay")) {
    const payRate = await getSingleByMemberId(db, "pay_rates", memberId);
    return Math.max(0, Number(payRate?.rate ?? 0));
  }
  const clientIds = await listClientIdsForProjectPg(projectId);
  if (!clientIds.length) return 0;
  const clientBudget = await getClientBudgetPg(clientIds[0]);
  return Math.max(0, Number(clientBudget?.cost ?? 0));
}

export async function deleteProjectMemberLimitPg(projectId, memberId) {
  const rows = await query(
    "DELETE FROM project_member_limits WHERE project_id = $1 AND member_id = $2 RETURNING id",
    [projectId, memberId],
  );
  return rows.length > 0;
}

export async function upsertProjectMemberLimitPg(projectId, memberId, data, actorId) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO project_member_limits (
       id, project_id, member_id, type, based_on, cost, resets, start_date, notify_at_pct,
       notify_project_members, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (project_id, member_id) DO UPDATE SET
       type = EXCLUDED.type, based_on = EXCLUDED.based_on, cost = EXCLUDED.cost, resets = EXCLUDED.resets,
       start_date = EXCLUDED.start_date, notify_at_pct = EXCLUDED.notify_at_pct,
       notify_project_members = EXCLUDED.notify_project_members, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [
      id,
      projectId,
      memberId,
      data.type ?? null,
      data.basedOn ?? null,
      data.cost ?? null,
      data.resets ?? "Never",
      dateOrNull(data.startDate),
      data.notifyAtPct ?? null,
      data.notifyProjectMembers ?? true,
      uuidOrNull(actorId),
    ],
  );
  return rows[0] ?? null;
}


export async function linkClientProjectPg(clientId, projectId, actorId) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO client_projects (id, client_id, project_id, assigned_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id, project_id) DO NOTHING RETURNING *`,
    [id, clientId, projectId, uuidOrNull(actorId)],
  );
  return rows[0] ?? null;
}

export async function unlinkClientProjectPg(clientId, projectId) {
  await query("DELETE FROM client_projects WHERE client_id = $1 AND project_id = $2", [clientId, projectId]);
}

export async function listClientIdsForProjectPg(projectId) {
  const rows = await query("SELECT client_id FROM client_projects WHERE project_id = $1", [projectId]);
  return rows.map((r) => r.client_id);
}

export async function listProjectIdsForClientPg(clientId) {
  const rows = await query("SELECT project_id FROM client_projects WHERE client_id = $1", [clientId]);
  return rows.map((r) => r.project_id);
}

export async function linkTeamProjectPg(teamId, projectId, actorId) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO team_projects (id, team_id, project_id, assigned_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (team_id, project_id) DO NOTHING RETURNING *`,
    [id, teamId, projectId, uuidOrNull(actorId)],
  );
  return rows[0] ?? null;
}

export async function unlinkTeamProjectPg(teamId, projectId) {
  await query("DELETE FROM team_projects WHERE team_id = $1 AND project_id = $2", [teamId, projectId]);
}

export async function deleteTeamProjectsForTeamPg(teamId) {
  await query("DELETE FROM team_projects WHERE team_id = $1", [teamId]);
}

export async function listTeamIdsForProjectPg(projectId) {
  const rows = await query("SELECT team_id FROM team_projects WHERE project_id = $1", [projectId]);
  return rows.map((r) => r.team_id);
}

export async function listProjectIdsForTeamPg(teamId) {
  const rows = await query("SELECT project_id FROM team_projects WHERE team_id = $1", [teamId]);
  return rows.map((r) => r.project_id);
}


export async function getProjectTrackedSecondsPg(projectId, options = {}) {
  const params = [projectId, projectId];
  let sessionWhere = "project_id = $1";
  let entryWhere = "project_id = $2 AND status != 'rejected'";

  if (options.fromDate) {
    params.push(options.fromDate);
    sessionWhere += ` AND started_at::date >= $${params.length}`;
    params.push(options.fromDate);
    entryWhere += ` AND date >= $${params.length}`;
  }
  if (options.toDate) {
    params.push(options.toDate);
    sessionWhere += ` AND started_at::date <= $${params.length}`;
    params.push(options.toDate);
    entryWhere += ` AND date <= $${params.length}`;
  }
  if (options.includeNonBillable === false) {
    entryWhere += " AND billable = true";
  }
  if (options.memberId) {
    params.push(options.memberId);
    sessionWhere += ` AND member_id = $${params.length}`;
    params.push(options.memberId);
    entryWhere += ` AND member_id = $${params.length}`;
  }

  const rows = await query(
    `SELECT COALESCE(SUM(secs), 0) AS total_seconds
     FROM (
       SELECT active_seconds AS secs FROM activity_sessions WHERE ${sessionWhere}
       UNION ALL
       SELECT duration AS secs FROM time_entries WHERE ${entryWhere}
     ) tracked`,
    params,
  );
  return Math.max(0, Math.floor(Number(rows[0]?.total_seconds ?? 0)));
}

export async function computeProjectSpentCostPg(db, projectId, options = {}) {
  const basedOn = String(options.basedOn || "").toLowerCase();
  const billableClause = options.includeNonBillable === false ? "AND billable = true" : "";
  const params = [projectId];
  let sessionDateClause = "";
  let entryDateClause = "";
  if (options.fromDate) {
    params.push(options.fromDate);
    sessionDateClause += ` AND started_at::date >= $${params.length}`;
    entryDateClause += ` AND date >= $${params.length}`;
  }
  if (options.toDate) {
    params.push(options.toDate);
    sessionDateClause += ` AND started_at::date <= $${params.length}`;
    entryDateClause += ` AND date <= $${params.length}`;
  }

  if (basedOn.includes("pay")) {
    const rows = await query(
      `SELECT member_id, SUM(secs) AS secs FROM (
         SELECT member_id, active_seconds AS secs FROM activity_sessions
         WHERE project_id = $1 ${sessionDateClause}
         UNION ALL
         SELECT member_id, duration AS secs FROM time_entries
         WHERE project_id = $1 AND status != 'rejected' ${billableClause} ${entryDateClause}
       ) tracked
       GROUP BY member_id`,
      params,
    );
    let total = 0;
    for (const row of rows) {
      const hours = Math.max(0, Number(row.secs ?? 0)) / 3600;
      if (hours <= 0) continue;
      const payRate = await getSingleByMemberId(db, "pay_rates", row.member_id);
      const rate = Number(payRate?.rate ?? 0);
      if (rate > 0) total += hours * rate;
    }
    return Math.round(total * 100) / 100;
  }

  const clientIds = await listClientIdsForProjectPg(projectId);
  if (!clientIds.length) return 0;
  const clientBudget = await getClientBudgetPg(clientIds[0]);
  const rate = Number(clientBudget?.cost ?? 0);
  if (rate <= 0) return 0;

  const seconds = await getProjectTrackedSecondsPg(projectId, {
    includeNonBillable: options.includeNonBillable,
    fromDate: options.fromDate,
    toDate: options.toDate,
  });
  const hours = seconds / 3600;
  return Math.round(hours * rate * 100) / 100;
}

export async function computeProjectSpentPg(db, projectId, budgetRow) {
  if (!budgetRow) return 0;
  const includeNonBillable = budgetRow.include_non_billable_time !== false;
  const fromDate = toDayStrOrNull(budgetRow.start_date);
  const toDate = toDayStrOrNull(budgetRow.end_date);
  if (String(budgetRow.type) === "Hours based") {
    const seconds = await getProjectTrackedSecondsPg(projectId, { includeNonBillable, fromDate, toDate });
    return Math.round((seconds / 3600) * 100) / 100;
  }
  return computeProjectSpentCostPg(db, projectId, {
    fromDate,
    toDate,
    basedOn: budgetRow.based_on,
    includeNonBillable,
  });
}

export async function computeProjectSpentForAllPg(db, budgetRows) {
  const result = new Map();
  if (!budgetRows.length) return result;

  const hoursRows = budgetRows.filter((r) => String(r.type) === "Hours based");
  const costRows = budgetRows.filter((r) => String(r.type) !== "Hours based");
  const payRateCostRows = costRows.filter((r) => String(r.based_on || "").toLowerCase().includes("pay"));
  const billRateCostRows = costRows.filter((r) => !String(r.based_on || "").toLowerCase().includes("pay"));

  async function trackedSecondsByProject(rows) {
    if (!rows.length) return new Map();
    const ids = rows.map((r) => r.id);
    const includeFlags = rows.map((r) => r.include_non_billable_time !== false);
    const startDates = rows.map((r) => toDayStrOrNull(r.start_date));
    const endDates = rows.map((r) => toDayStrOrNull(r.end_date));
    const dbRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[], $3::date[], $4::date[]) AS t(project_id, include_non_billable, start_date, end_date)
       )
       SELECT project_id, SUM(secs) AS total_seconds FROM (
         SELECT s.project_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         WHERE (f.start_date IS NULL OR s.started_at::date >= f.start_date)
           AND (f.end_date IS NULL OR s.started_at::date <= f.end_date)
         UNION ALL
         SELECT te.project_id, te.duration AS secs
         FROM time_entries te
         JOIN proj_flags f ON f.project_id = te.project_id
         WHERE te.status != 'rejected'
           AND (f.include_non_billable OR te.billable = true)
           AND (f.start_date IS NULL OR te.date >= f.start_date)
           AND (f.end_date IS NULL OR te.date <= f.end_date)
       ) tracked
       GROUP BY project_id`,
      [ids, includeFlags, startDates, endDates],
    );
    return new Map(dbRows.map((r) => [r.project_id, Math.max(0, Number(r.total_seconds ?? 0))]));
  }

  const hoursSeconds = await trackedSecondsByProject(hoursRows);
  for (const row of hoursRows) {
    result.set(row.id, Math.round(((hoursSeconds.get(row.id) ?? 0) / 3600) * 100) / 100);
  }

  if (payRateCostRows.length) {
    const ids = payRateCostRows.map((r) => r.id);
    const includeFlags = payRateCostRows.map((r) => r.include_non_billable_time !== false);
    const startDates = payRateCostRows.map((r) => toDayStrOrNull(r.start_date));
    const endDates = payRateCostRows.map((r) => toDayStrOrNull(r.end_date));
    const memberRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[], $3::date[], $4::date[]) AS t(project_id, include_non_billable, start_date, end_date)
       )
       SELECT project_id, member_id, SUM(secs) AS secs FROM (
         SELECT s.project_id, s.member_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         WHERE (f.start_date IS NULL OR s.started_at::date >= f.start_date)
           AND (f.end_date IS NULL OR s.started_at::date <= f.end_date)
         UNION ALL
         SELECT te.project_id, te.member_id, te.duration AS secs
         FROM time_entries te
         JOIN proj_flags f ON f.project_id = te.project_id
         WHERE te.status != 'rejected'
           AND (f.include_non_billable OR te.billable = true)
           AND (f.start_date IS NULL OR te.date >= f.start_date)
           AND (f.end_date IS NULL OR te.date <= f.end_date)
       ) tracked
       GROUP BY project_id, member_id`,
      [ids, includeFlags, startDates, endDates],
    );
    const distinctMemberIds = [...new Set(memberRows.map((r) => r.member_id))];
    const rateEntries = await Promise.all(
      distinctMemberIds.map(async (memberId) => {
        const payRate = await getSingleByMemberId(db, "pay_rates", memberId);
        return [memberId, Number(payRate?.rate ?? 0)];
      }),
    );
    const rateByMember = new Map(rateEntries);
    const totalsByProject = new Map();
    for (const row of memberRows) {
      const rate = rateByMember.get(row.member_id) ?? 0;
      if (rate <= 0) continue;
      const hours = Math.max(0, Number(row.secs ?? 0)) / 3600;
      totalsByProject.set(row.project_id, (totalsByProject.get(row.project_id) ?? 0) + hours * rate);
    }
    for (const row of payRateCostRows) {
      result.set(row.id, Math.round((totalsByProject.get(row.id) ?? 0) * 100) / 100);
    }
  }

  if (billRateCostRows.length) {
    const ids = billRateCostRows.map((r) => r.id);
    const clientLinkRows = await query(
      "SELECT DISTINCT ON (project_id) project_id, client_id FROM client_projects WHERE project_id = ANY($1::uuid[]) ORDER BY project_id, assigned_at",
      [ids],
    );
    const clientIdByProject = new Map(clientLinkRows.map((r) => [r.project_id, r.client_id]));
    const distinctClientIds = [...new Set(clientIdByProject.values())];
    const clientBudgetRows = distinctClientIds.length
      ? await query("SELECT client_id, cost FROM client_budgets WHERE client_id = ANY($1::uuid[])", [distinctClientIds])
      : [];
    const rateByClient = new Map(clientBudgetRows.map((r) => [r.client_id, Number(r.cost ?? 0)]));
    const rowsWithRate = billRateCostRows.filter((r) => {
      const clientId = clientIdByProject.get(r.id);
      return clientId && (rateByClient.get(clientId) ?? 0) > 0;
    });
    const secondsByProject = await trackedSecondsByProject(rowsWithRate);
    for (const row of billRateCostRows) {
      const clientId = clientIdByProject.get(row.id);
      const rate = clientId ? rateByClient.get(clientId) ?? 0 : 0;
      if (rate <= 0) {
        result.set(row.id, 0);
        continue;
      }
      const hours = (secondsByProject.get(row.id) ?? 0) / 3600;
      result.set(row.id, Math.round(hours * rate * 100) / 100);
    }
  }

  return result;
}


export async function computeProjectBudgetTargetForAllPg(db, budgetRows) {
  const result = new Map();
  const perPersonRows = budgetRows.filter((r) => r.scope === "per_person" && Number(r.cost) > 0);
  if (!perPersonRows.length) return result;

  const ids = perPersonRows.map((r) => r.id);
  const memberRows = await query(
    "SELECT project_id, member_id FROM project_members WHERE project_id = ANY($1::uuid[])",
    [ids],
  );
  const membersByProject = new Map();
  for (const row of memberRows) {
    if (!membersByProject.has(row.project_id)) membersByProject.set(row.project_id, []);
    membersByProject.get(row.project_id).push(row.member_id);
  }

  const hoursRows = perPersonRows.filter((r) => String(r.type) === "Hours based");
  for (const row of hoursRows) {
    const memberCount = membersByProject.get(row.id)?.length ?? 0;
    result.set(row.id, Math.round(Number(row.cost) * memberCount * 100) / 100);
  }

  const costRows = perPersonRows.filter((r) => String(r.type) !== "Hours based");
  const payRateRows = costRows.filter((r) => String(r.based_on || "").toLowerCase().includes("pay"));
  const billRateRows = costRows.filter((r) => !String(r.based_on || "").toLowerCase().includes("pay"));

  if (payRateRows.length) {
    const distinctMemberIds = [...new Set(payRateRows.flatMap((r) => membersByProject.get(r.id) ?? []))];
    const rateEntries = await Promise.all(
      distinctMemberIds.map(async (memberId) => {
        const payRate = await getSingleByMemberId(db, "pay_rates", memberId);
        return [memberId, Number(payRate?.rate ?? 0)];
      }),
    );
    const rateByMember = new Map(rateEntries);
    for (const row of payRateRows) {
      const memberIds = membersByProject.get(row.id) ?? [];
      let total = 0;
      for (const memberId of memberIds) {
        total += Number(row.cost) * (rateByMember.get(memberId) ?? 0);
      }
      result.set(row.id, Math.round(total * 100) / 100);
    }
  }

  if (billRateRows.length) {
    const ids2 = billRateRows.map((r) => r.id);
    const clientLinkRows = await query(
      "SELECT DISTINCT ON (project_id) project_id, client_id FROM client_projects WHERE project_id = ANY($1::uuid[]) ORDER BY project_id, assigned_at",
      [ids2],
    );
    const clientIdByProject = new Map(clientLinkRows.map((r) => [r.project_id, r.client_id]));
    const distinctClientIds = [...new Set(clientIdByProject.values())];
    const clientBudgetRows = distinctClientIds.length
      ? await query("SELECT client_id, cost FROM client_budgets WHERE client_id = ANY($1::uuid[])", [distinctClientIds])
      : [];
    const rateByClient = new Map(clientBudgetRows.map((r) => [r.client_id, Number(r.cost ?? 0)]));
    for (const row of billRateRows) {
      const clientId = clientIdByProject.get(row.id);
      const rate = clientId ? rateByClient.get(clientId) ?? 0 : 0;
      const memberCount = membersByProject.get(row.id)?.length ?? 0;
      result.set(row.id, Math.round(Number(row.cost) * memberCount * rate * 100) / 100);
    }
  }

  return result;
}

export async function computeProjectBudgetTargetPg(db, projectId, budgetRow) {
  if (!budgetRow) return 0;
  if (budgetRow.scope !== "per_person") return Number(budgetRow.cost ?? 0);
  const map = await computeProjectBudgetTargetForAllPg(db, [
    { id: projectId, type: budgetRow.type, based_on: budgetRow.based_on, scope: budgetRow.scope, cost: budgetRow.cost },
  ]);
  return map.get(projectId) ?? 0;
}

export async function getProjectActivityMetricsPg({ projectIds = null, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT s.project_id, s.member_id,
              s.active_seconds AS active_seconds,
              s.idle_seconds   AS idle_seconds,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       UNION ALL
       SELECT te.project_id, te.member_id,
              te.duration AS active_seconds,
              0           AS idle_seconds,
              te.date     AS day
       FROM time_entries te
       WHERE te.status <> 'rejected'
     )
     SELECT project_id,
            SUM(active_seconds) AS active_seconds,
            SUM(idle_seconds)   AS idle_seconds,
            ARRAY_AGG(DISTINCT member_id) FILTER (WHERE member_id IS NOT NULL) AS member_ids
     FROM worked
     WHERE project_id IS NOT NULL
       AND day >= $1::date AND day <= $2::date
       AND ($3::uuid[] IS NULL OR project_id = ANY($3::uuid[]))
     GROUP BY project_id`,
    [fromDay, toDay, projectIds],
  );

  const byProject = new Map();
  for (const row of rows) {
    byProject.set(String(row.project_id), {
      activeSeconds: Math.max(0, Number(row.active_seconds) || 0),
      idleSeconds: Math.max(0, Number(row.idle_seconds) || 0),
      memberIds: new Set((row.member_ids ?? []).map((id) => String(id))),
    });
  }
  return byProject;
}

export async function getDailyActivityTotalsPg({ projectIds = null, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT s.project_id,
              s.active_seconds AS active_seconds,
              s.idle_seconds   AS idle_seconds,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       UNION ALL
       SELECT te.project_id, te.duration, 0, te.date
       FROM time_entries te
       WHERE te.status <> 'rejected'
     )
     SELECT day,
            SUM(active_seconds) AS active_seconds,
            SUM(idle_seconds)   AS idle_seconds
     FROM worked
     WHERE day >= $1::date AND day <= $2::date
       AND ($3::uuid[] IS NULL OR project_id = ANY($3::uuid[]))
     GROUP BY day`,
    [fromDay, toDay, projectIds],
  );

  const byDay = new Map();
  for (const row of rows) {
    const key = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
    byDay.set(key, {
      activeSeconds: Math.max(0, Number(row.active_seconds) || 0),
      idleSeconds: Math.max(0, Number(row.idle_seconds) || 0),
    });
  }
  return byDay;
}

export async function getMemberWeeklyCapacityPg(memberIds = null) {
  const rows = await query(
    `SELECT m.id,
            l.weekly AS weekly_limit_hours,
            COALESCE(jsonb_array_length(ts.work_days), 5) AS work_day_count
     FROM members m
     LEFT JOIN limits l ON l.member_id = m.id
     LEFT JOIN time_settings ts ON ts.member_id = m.id
     WHERE m.status <> 'banned'
       AND ($1::uuid[] IS NULL OR m.id = ANY($1::uuid[]))`,
    [memberIds],
  );
  const byMember = new Map();
  for (const row of rows) {
    const weeklyHours = Number(row.weekly_limit_hours);
    const capacityHours =
      Number.isFinite(weeklyHours) && weeklyHours > 0
        ? weeklyHours
        : (Number(row.work_day_count) || 5) * 8;
    byMember.set(String(row.id), Math.round(capacityHours * 3600));
  }
  return byMember;
}

export async function getMemberActivitySecondsPg({ projectIds = null, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT s.project_id, s.member_id,
              s.active_seconds AS active_seconds,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       UNION ALL
       SELECT te.project_id, te.member_id, te.duration, te.date
       FROM time_entries te
       WHERE te.status <> 'rejected'
     )
     SELECT project_id, member_id, SUM(active_seconds) AS active_seconds
     FROM worked
     WHERE project_id IS NOT NULL AND member_id IS NOT NULL
       AND day >= $1::date AND day <= $2::date
       AND ($3::uuid[] IS NULL OR project_id = ANY($3::uuid[]))
     GROUP BY project_id, member_id`,
    [fromDay, toDay, projectIds],
  );

  const byProject = new Map();
  for (const row of rows) {
    const projectId = String(row.project_id);
    if (!byProject.has(projectId)) byProject.set(projectId, new Map());
    byProject.get(projectId).set(String(row.member_id), Math.max(0, Number(row.active_seconds) || 0));
  }
  return byProject;
}

export async function getMemberDailyActivityTotalsPg({ projectIds = null, memberId, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT s.project_id, s.member_id,
              s.active_seconds AS active_seconds,
              s.idle_seconds   AS idle_seconds,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       UNION ALL
       SELECT te.project_id, te.member_id, te.duration, 0, te.date
       FROM time_entries te
       WHERE te.status <> 'rejected'
     )
     SELECT day,
            SUM(active_seconds) AS active_seconds,
            SUM(idle_seconds)   AS idle_seconds
     FROM worked
     WHERE member_id = $4
       AND day >= $1::date AND day <= $2::date
       AND ($3::uuid[] IS NULL OR project_id = ANY($3::uuid[]))
     GROUP BY day`,
    [fromDay, toDay, projectIds, memberId],
  );

  const byDay = new Map();
  for (const row of rows) {
    const key = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
    byDay.set(key, {
      activeSeconds: Math.max(0, Number(row.active_seconds) || 0),
      idleSeconds: Math.max(0, Number(row.idle_seconds) || 0),
    });
  }
  return byDay;
}

export async function getMemberProjectActivityMetricsPg({ projectIds = null, memberId, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT s.project_id, s.member_id,
              s.active_seconds AS active_seconds,
              s.idle_seconds   AS idle_seconds,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       UNION ALL
       SELECT te.project_id, te.member_id,
              te.duration AS active_seconds,
              0           AS idle_seconds,
              te.date     AS day
       FROM time_entries te
       WHERE te.status <> 'rejected'
     )
     SELECT project_id,
            SUM(active_seconds) AS active_seconds,
            SUM(idle_seconds)   AS idle_seconds
     FROM worked
     WHERE project_id IS NOT NULL AND member_id = $4
       AND day >= $1::date AND day <= $2::date
       AND ($3::uuid[] IS NULL OR project_id = ANY($3::uuid[]))
     GROUP BY project_id`,
    [fromDay, toDay, projectIds, memberId],
  );

  const byProject = new Map();
  for (const row of rows) {
    byProject.set(String(row.project_id), {
      activeSeconds: Math.max(0, Number(row.active_seconds) || 0),
      idleSeconds: Math.max(0, Number(row.idle_seconds) || 0),
    });
  }
  return byProject;
}
