// Postgres-backed CRUD + queries for the projects domain (projects,
// project_members, project_budgets, project_member_limits, client_projects,
// team_projects). See PROPOSAL-Projects-Migration-to-PostgreSQL.md.
//
// Wired into every real read/write path (routes, dashboard loader, overview,
// activity-scope, task-assignments, team-roster, client-service, bootstrap).
// Schema is applied at boot by lib/postgres/ensure-lookup-schema.js.

import crypto from "node:crypto";
import { query } from "./client.js";
import { getSingleByMemberId } from "./member-data-store.js";
import { getClientBudgetPg } from "./clients-postgres.service.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function dateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

/** @param {{ name: string, status?: string, billable?: boolean, disableActivity?: boolean,
 *   allowProjectTracking?: boolean, disableIdleTime?: boolean, idleTimeSeconds?: number, clientId?: string|null,
 *   managersNotes?: string, usersNotes?: string, viewersNotes?: string,
 *   type?: "normal"|"calling", endDate?: string|null, createdBy?: string }} data */
export async function createProjectPg(data) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO projects (
       id, name, status, billable, disable_activity, allow_project_tracking, disable_idle_time,
       idle_time_seconds, client_id, managers_notes, users_notes, viewers_notes, type, end_date, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      id,
      data.name,
      data.status ?? "active",
      data.billable ?? true,
      data.disableActivity ?? false,
      data.allowProjectTracking ?? true,
      data.disableIdleTime ?? false,
      // 450s = 7.5 minutes, the product default a new project gets when the
      // creator doesn't touch the idle-time field (ID-1/ID-2 of the plan).
      Number.isFinite(data.idleTimeSeconds) ? Math.max(0, Math.floor(data.idleTimeSeconds)) : 450,
      uuidOrNull(data.clientId),
      data.managersNotes ?? null,
      data.usersNotes ?? null,
      data.viewersNotes ?? null,
      data.type ?? "normal",
      dateOrNull(data.endDate),
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

/**
 * @param {string} id @param {Record<string, unknown>} patch
 * @param {string} [expectedUpdatedAt] Optimistic-concurrency token (§6.9).
 *   Optional so existing callers (and the Tauri agent) keep working
 *   unchanged - only a caller that actually sends one back gets the
 *   conditional-write behavior.
 */
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
            : patch[key],
    );
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getProjectPg(id);
  sets.push("updated_at = now()");
  const where = expectedUpdatedAt
    ? `WHERE id = $1 AND updated_at = $${params.push(expectedUpdatedAt)}`
    : "WHERE id = $1";
  const rows = await query(`UPDATE projects SET ${sets.join(", ")} ${where} RETURNING *`, params);
  if (rows.length === 0 && expectedUpdatedAt) {
    // Someone wrote first - zero rows means the WHERE's updated_at check
    // failed to match, not that the project doesn't exist (id alone would
    // have matched). Caller maps this to a 409 with the current row.
    return { conflict: true, current: await getProjectPg(id) };
  }
  const project = rows[0] ?? null;
  if (project) void publishChange("projects", id, "updated", uuidOrNull(patch.updatedBy) ?? undefined);
  return project;
}

/** Soft-archive, matching the existing status-flag pattern rather than
 * deleting the row. expectedUpdatedAt optional, same conditional-write
 * contract as updateProjectPg (§6.9 case 28: archive racing a rename). */
export async function archiveProjectPg(id, actorId, expectedUpdatedAt) {
  const params = [id, uuidOrNull(actorId)];
  const where = expectedUpdatedAt ? `WHERE id = $1 AND updated_at = $${params.push(expectedUpdatedAt)}` : "WHERE id = $1";
  const rows = await query(
    `UPDATE projects SET status = 'archived', archived_by = $2, archived_at = now(), updated_at = now() ${where} RETURNING *`,
    params,
  );
  if (rows.length === 0 && expectedUpdatedAt) {
    return { conflict: true, current: await getProjectPg(id) };
  }
  const project = rows[0] ?? null;
  // Archiving doesn't remove the row - an open edit form should offer to
  // reload, not force-close like a real delete does (§4.1's action field).
  if (project) void publishChange("projects", id, "updated", uuidOrNull(actorId) ?? undefined);
  return project;
}

/** @param {string} id @param {string} [actorId] */
export async function deleteProjectPg(id, actorId) {
  await query("DELETE FROM projects WHERE id = $1", [id]);
  void publishChange("projects", id, "deleted", uuidOrNull(actorId) ?? undefined);
}

/** @param {{ status?: string, limit?: number }} [options] */
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

// ---------------------------------------------------------------------------
// project_members
// ---------------------------------------------------------------------------

export async function addProjectMemberPg(projectId, memberId, options = {}) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO project_members (id, project_id, member_id, project_role, assigned_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (project_id, member_id) DO UPDATE SET project_role = EXCLUDED.project_role, updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [id, projectId, memberId, options.role ?? null, uuidOrNull(options.actorId)],
  );
  const row = rows[0] ?? null;
  if (row) void publishChange("project-members", projectId, "updated", uuidOrNull(options.actorId) ?? undefined);
  return row;
}

export async function removeProjectMemberPg(projectId, memberId, actorId) {
  await query("DELETE FROM project_members WHERE project_id = $1 AND member_id = $2", [projectId, memberId]);
  void publishChange("project-members", projectId, "updated", uuidOrNull(actorId) ?? undefined);
}

export async function listProjectMembersPg(projectId) {
  return query("SELECT * FROM project_members WHERE project_id = $1", [projectId]);
}

/** Every project a member belongs to - mirrors getProjectScopedMemberIds's Firestore query. */
export async function listProjectIdsForMemberPg(memberId) {
  const rows = await query("SELECT project_id FROM project_members WHERE member_id = $1 LIMIT 200", [memberId]);
  return rows.map((r) => r.project_id);
}

/** Every member on a set of projects - the reverse lookup activity-scope.js needs. */
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

// ---------------------------------------------------------------------------
// project_budgets
// ---------------------------------------------------------------------------

export async function getProjectBudgetPg(projectId) {
  const rows = await query("SELECT * FROM project_budgets WHERE project_id = $1 LIMIT 1", [projectId]);
  return rows[0] ?? null;
}

export async function getAllProjectBudgetsPg() {
  return query("SELECT * FROM project_budgets");
}

/**
 * Create-or-replace, matching the one-row-per-project shape the Firestore doc had.
 * @param {string} projectId @param {object} data @param {string} [actorId]
 * @param {string} [expectedUpdatedAt] §6.9 - only checked when a budget row already
 *   exists; a first-time create has nothing to conflict with.
 */
export async function upsertProjectBudgetPg(projectId, data, actorId, expectedUpdatedAt) {
  const existing = await getProjectBudgetPg(projectId);

  if (existing && expectedUpdatedAt) {
    const rows = await query(
      `UPDATE project_budgets SET
         type = $2, based_on = $3, scope = $4, cost = $5, notify_project_members = $6, notify_at_pct = $7,
         who_to_notify = $8, stop_timers_when_reached = $9, stop_timers_at_pct = $10, resets = $11,
         start_date = $12, include_non_billable_time = $13, updated_by = $14, updated_at = now()
       WHERE project_id = $1 AND updated_at = $15
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
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     ON CONFLICT (project_id) DO UPDATE SET
       type = EXCLUDED.type, based_on = EXCLUDED.based_on, scope = EXCLUDED.scope, cost = EXCLUDED.cost,
       notify_project_members = EXCLUDED.notify_project_members, notify_at_pct = EXCLUDED.notify_at_pct,
       who_to_notify = EXCLUDED.who_to_notify, stop_timers_when_reached = EXCLUDED.stop_timers_when_reached,
       stop_timers_at_pct = EXCLUDED.stop_timers_at_pct, resets = EXCLUDED.resets,
       start_date = EXCLUDED.start_date, include_non_billable_time = EXCLUDED.include_non_billable_time,
       updated_by = EXCLUDED.updated_by, updated_at = now()
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
    ],
  );
  const budget = rows[0] ?? null;
  if (budget) void publishChange("project-budgets", projectId, "updated", uuidOrNull(actorId) ?? undefined);
  return budget;
}

// ---------------------------------------------------------------------------
// project_member_limits
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// client_projects / team_projects (junctions)
// ---------------------------------------------------------------------------

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

/** Team itself lives in Firestore, so there's no FK to cascade this on delete. */
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

// ---------------------------------------------------------------------------
// real "spent" tracking (see proposal doc "Related Bug" #3 - today this is
// fabricated everywhere it's shown; this is the first real implementation)
// ---------------------------------------------------------------------------

/**
 * Tracked seconds for a project within a date range, from BOTH real time
 * sources: live timer sessions (activity_sessions) and manually filed
 * timesheet rows (time_entries). These are two different sources of truth,
 * not two representations of the same fact, so UNION ALL rather than a join -
 * a normal-project task timer and a calling-project task-less timer both land
 * in activity_sessions (project_id is populated for both, see the ALTER TABLE
 * comment on that column), while manual entries only ever land in
 * time_entries. Before this, only time_entries was read here, so project
 * spend never moved even while timers ran (see proposal doc "Related Bug" #1).
 *
 * Legacy caveat, accepted rather than backfilled: activity_sessions rows
 * written before its project_id column existed are NULL there and are not
 * counted here. No backfill in this codebase - test environment, existing
 * rows are disposable.
 *
 * activity_sessions has no billable flag - sessions are always treated as
 * billable (matches how the timer is used); includeNonBillable only filters
 * the time_entries leg.
 * @param {string} projectId
 * @param {{ fromDate?: string|null, toDate?: string|null, includeNonBillable?: boolean }} [options]
 */
export async function getProjectTrackedSecondsPg(projectId, options = {}) {
  // One shared params array - every placeholder below is numbered against
  // this array's final length, not against each subquery in isolation, since
  // both WHERE clauses land in the same query string.
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

/**
 * Cost-based "spent" (dollar amount), computed from real tracked time x a
 * real rate - not a guess, and not a stored column (rates change; this always
 * reflects the current rate at read time, same as the rest of this file's
 * philosophy of computing from source data rather than caching a number that
 * can drift).
 *
 * based_on "Pay rate": each logging member's own hourly pay rate (pay_rates,
 *   Firestore - not migrated, see project-budgets schema comment) applied to
 *   the hours *that member* logged.
 * based_on anything else (default "Bill rate"): the project's first linked
 *   client's rate (client_budgets.cost when the client budget is hourly)
 *   applied to all tracked hours on the project.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 * @param {{ basedOn?: string, includeNonBillable?: boolean }} [options]
 */
export async function computeProjectSpentCostPg(db, projectId, options = {}) {
  const basedOn = String(options.basedOn || "").toLowerCase();
  const billableClause = options.includeNonBillable === false ? "AND billable = true" : "";

  if (basedOn.includes("pay")) {
    // Same two-source union as getProjectTrackedSecondsPg, but grouped by
    // member instead of summed flat - each member's own pay rate applies only
    // to the hours *that member* logged. activity_sessions has member_id too,
    // so calling-project timers (which have no time_entries row at all) are
    // covered here as well.
    const rows = await query(
      `SELECT member_id, SUM(secs) AS secs FROM (
         SELECT member_id, active_seconds AS secs FROM activity_sessions
         WHERE project_id = $1
         UNION ALL
         SELECT member_id, duration AS secs FROM time_entries
         WHERE project_id = $1 AND status != 'rejected' ${billableClause}
       ) tracked
       GROUP BY member_id`,
      [projectId],
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
  });
  const hours = seconds / 3600;
  return Math.round(hours * rate * 100) / 100;
}

/**
 * Real "spent" for a project's budget, in whatever unit the budget is
 * denominated in (hours for an Hours-based budget, dollars for Cost-based) -
 * the single entry point overview/table code should call instead of either
 * fabricating a number or hand-picking which helper above to use.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 * @param {{ type?: string, based_on?: string, include_non_billable_time?: boolean } | null} budgetRow
 */
export async function computeProjectSpentPg(db, projectId, budgetRow) {
  if (!budgetRow) return 0;
  const includeNonBillable = budgetRow.include_non_billable_time !== false;
  if (String(budgetRow.type) === "Hours based") {
    const seconds = await getProjectTrackedSecondsPg(projectId, { includeNonBillable });
    return Math.round((seconds / 3600) * 100) / 100;
  }
  return computeProjectSpentCostPg(db, projectId, {
    basedOn: budgetRow.based_on,
    includeNonBillable,
  });
}

/**
 * Batched replacement for calling computeProjectSpentPg in a loop (the N+1
 * overview-service.js and the /api/project-budgets GET route both had - one
 * query per project, plus one Firestore read per member per project for
 * cost-based/pay-rate budgets). This does one grouped SQL pass for every
 * Hours-based project, one grouped SQL pass for every Cost-based project's
 * tracked seconds, and fetches each *distinct* member/client rate exactly
 * once via Promise.all, no matter how many projects reference it.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ id: string, type?: string, based_on?: string, include_non_billable_time?: boolean }[]} budgetRows
 *   One row per project that has a budget (skip projects with none - they're 0 spend, not worth a query).
 * @returns {Promise<Map<string, number>>} project_id -> spent, in the budget's own unit (hours or cost)
 */
export async function computeProjectSpentForAllPg(db, budgetRows) {
  const result = new Map();
  if (!budgetRows.length) return result;

  const hoursRows = budgetRows.filter((r) => String(r.type) === "Hours based");
  const costRows = budgetRows.filter((r) => String(r.type) !== "Hours based");
  const payRateCostRows = costRows.filter((r) => String(r.based_on || "").toLowerCase().includes("pay"));
  const billRateCostRows = costRows.filter((r) => !String(r.based_on || "").toLowerCase().includes("pay"));

  // One grouped query for every Hours-based project's seconds. Per-project
  // includeNonBillable flags ride along as a joined VALUES list rather than
  // branching into one query per distinct flag value.
  async function trackedSecondsByProject(rows) {
    if (!rows.length) return new Map();
    const ids = rows.map((r) => r.id);
    const includeFlags = rows.map((r) => r.include_non_billable_time !== false);
    const dbRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[]) AS t(project_id, include_non_billable)
       )
       SELECT project_id, SUM(secs) AS total_seconds FROM (
         SELECT s.project_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         UNION ALL
         SELECT te.project_id, te.duration AS secs
         FROM time_entries te
         JOIN proj_flags f ON f.project_id = te.project_id
         WHERE te.status != 'rejected'
           AND (f.include_non_billable OR te.billable = true)
       ) tracked
       GROUP BY project_id`,
      [ids, includeFlags],
    );
    return new Map(dbRows.map((r) => [r.project_id, Math.max(0, Number(r.total_seconds ?? 0))]));
  }

  const hoursSeconds = await trackedSecondsByProject(hoursRows);
  for (const row of hoursRows) {
    result.set(row.id, Math.round(((hoursSeconds.get(row.id) ?? 0) / 3600) * 100) / 100);
  }

  // Cost-based / pay rate: seconds grouped by (project, member), then one
  // Firestore read per *distinct* member across every project, in parallel -
  // not one read per member per project.
  if (payRateCostRows.length) {
    const ids = payRateCostRows.map((r) => r.id);
    const includeFlags = payRateCostRows.map((r) => r.include_non_billable_time !== false);
    const memberRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[]) AS t(project_id, include_non_billable)
       )
       SELECT project_id, member_id, SUM(secs) AS secs FROM (
         SELECT s.project_id, s.member_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         UNION ALL
         SELECT te.project_id, te.member_id, te.duration AS secs
         FROM time_entries te
         JOIN proj_flags f ON f.project_id = te.project_id
         WHERE te.status != 'rejected'
           AND (f.include_non_billable OR te.billable = true)
       ) tracked
       GROUP BY project_id, member_id`,
      [ids, includeFlags],
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

  // Cost-based / bill rate (default): each project's own rate comes from its
  // first linked client's hourly budget cost - one query for the client
  // links, one query for every distinct client's rate, not one Firestore
  // read per project (client_budgets is Postgres-resident since Phase 8 of
  // the Clients migration, so this is a single SQL round-trip, not a batch
  // of individual reads).
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

// ---------------------------------------------------------------------------
// per_person budget target - "cost" on a scope='per_person' row is hours-per-
// member, not a total (see ensure-lookup-schema.js's project_budgets comment
// and project-budget-capacity.js). scope='per_project' rows need no
// computation here at all - their `cost` already is the total, unchanged.
// ---------------------------------------------------------------------------

/**
 * Batched live total for every scope='per_person' row in `budgetRows` -
 * mirrors computeProjectSpentForAllPg's shape/batching, but sums against
 * EVERY current project member (not just the ones who have logged time,
 * since the point of a per-person target is "what if everyone hits it").
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ id: string, type?: string, based_on?: string, scope?: string, cost?: number }[]} budgetRows
 * @returns {Promise<Map<string, number>>} project_id -> live total, in the budget's own unit (hours or cost)
 */
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

  // Pay rate: each member's own rate x the shared per-person hours target,
  // summed across every current member - one Firestore read per distinct
  // member across every project, not one per member per project.
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

  // Bill rate: one project-wide rate (first linked client's hourly cost) x
  // per-person hours x current headcount.
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

/**
 * Single-project convenience wrapper around computeProjectBudgetTargetForAllPg
 * - for scope='per_project' rows this is just `cost`, unchanged.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 * @param {{ type?: string, based_on?: string, scope?: string, cost?: number } | null} budgetRow
 */
export async function computeProjectBudgetTargetPg(db, projectId, budgetRow) {
  if (!budgetRow) return 0;
  if (budgetRow.scope !== "per_person") return Number(budgetRow.cost ?? 0);
  const map = await computeProjectBudgetTargetForAllPg(db, [
    { id: projectId, type: budgetRow.type, based_on: budgetRow.based_on, scope: budgetRow.scope, cost: budgetRow.cost },
  ]);
  return map.get(projectId) ?? 0;
}
