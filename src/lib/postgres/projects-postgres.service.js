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
 *   allowProjectTracking?: boolean, disableIdleTime?: boolean, clientId?: string|null,
 *   managersNotes?: string, usersNotes?: string, viewersNotes?: string,
 *   type?: "normal"|"calling", createdBy?: string }} data */
export async function createProjectPg(data) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO projects (
       id, name, status, billable, disable_activity, allow_project_tracking, disable_idle_time,
       client_id, managers_notes, users_notes, viewers_notes, type, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     RETURNING *`,
    [
      id,
      data.name,
      data.status ?? "active",
      data.billable ?? true,
      data.disableActivity ?? false,
      data.allowProjectTracking ?? true,
      data.disableIdleTime ?? false,
      uuidOrNull(data.clientId),
      data.managersNotes ?? null,
      data.usersNotes ?? null,
      data.viewersNotes ?? null,
      data.type ?? "normal",
      uuidOrNull(data.createdBy),
    ],
  );
  return rows[0] ?? null;
}

export async function getProjectPg(id) {
  const rows = await query("SELECT * FROM projects WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

/** @param {string} id @param {Record<string, unknown>} patch */
export async function updateProjectPg(id, patch) {
  const columns = {
    name: "name",
    status: "status",
    billable: "billable",
    disableActivity: "disable_activity",
    allowProjectTracking: "allow_project_tracking",
    disableIdleTime: "disable_idle_time",
    clientId: "client_id",
    managersNotes: "managers_notes",
    usersNotes: "users_notes",
    viewersNotes: "viewers_notes",
    updatedBy: "updated_by",
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push(key === "clientId" ? uuidOrNull(patch[key]) : patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getProjectPg(id);
  sets.push("updated_at = now()");
  const rows = await query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return rows[0] ?? null;
}

/** Soft-archive, matching the existing status-flag pattern rather than deleting the row. */
export async function archiveProjectPg(id, actorId) {
  const rows = await query(
    `UPDATE projects SET status = 'archived', archived_by = $2, archived_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, uuidOrNull(actorId)],
  );
  return rows[0] ?? null;
}

export async function deleteProjectPg(id) {
  await query("DELETE FROM projects WHERE id = $1", [id]);
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
  return rows[0] ?? null;
}

export async function removeProjectMemberPg(projectId, memberId) {
  await query("DELETE FROM project_members WHERE project_id = $1 AND member_id = $2", [projectId, memberId]);
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

/** Create-or-replace, matching the one-row-per-project shape the Firestore doc had. */
export async function upsertProjectBudgetPg(projectId, data, actorId) {
  const existing = await getProjectBudgetPg(projectId);
  const id = existing?.id ?? crypto.randomUUID();
  const rows = await query(
    `INSERT INTO project_budgets (
       id, project_id, type, based_on, cost, notify_project_members, notify_at_pct, who_to_notify,
       stop_timers_when_reached, stop_timers_at_pct, resets, start_date, include_non_billable_time,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     ON CONFLICT (project_id) DO UPDATE SET
       type = EXCLUDED.type, based_on = EXCLUDED.based_on, cost = EXCLUDED.cost,
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
  return rows[0] ?? null;
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
 * Tracked seconds for a project within a date range, from the real time_entries
 * table - this IS a correct "hours spent" number for an Hours-based budget.
 * @param {string} projectId
 * @param {{ fromDate?: string|null, toDate?: string|null, includeNonBillable?: boolean }} [options]
 */
export async function getProjectTrackedSecondsPg(projectId, options = {}) {
  const params = [projectId];
  let where = "project_id = $1 AND status != 'rejected'";
  if (options.fromDate) {
    params.push(options.fromDate);
    where += ` AND date >= $${params.length}`;
  }
  if (options.toDate) {
    params.push(options.toDate);
    where += ` AND date <= $${params.length}`;
  }
  if (options.includeNonBillable === false) {
    where += " AND billable = true";
  }
  const rows = await query(`SELECT COALESCE(SUM(duration), 0) AS total FROM time_entries WHERE ${where}`, params);
  return Math.max(0, Math.floor(Number(rows[0]?.total ?? 0)));
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
    const rows = await query(
      `SELECT member_id, COALESCE(SUM(duration), 0) AS secs FROM time_entries
       WHERE project_id = $1 AND status != 'rejected' ${billableClause}
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
  const clientSnap = await db.collection("client_budgets").where("client_id", "==", clientIds[0]).limit(1).get();
  const rate = Number(clientSnap.docs[0]?.data()?.cost ?? 0);
  if (rate <= 0) return 0;

  const hoursRows = await query(
    `SELECT COALESCE(SUM(duration), 0) AS secs FROM time_entries
     WHERE project_id = $1 AND status != 'rejected' ${billableClause}`,
    [projectId],
  );
  const hours = Math.max(0, Number(hoursRows[0]?.secs ?? 0)) / 3600;
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
