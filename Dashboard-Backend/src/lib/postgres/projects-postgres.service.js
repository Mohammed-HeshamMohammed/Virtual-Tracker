
import crypto from "node:crypto";
import { isProjectTrackerRow } from "../../modules/projects/project-trackers.js";
import { query, withTransaction } from "./client.js";
import { getSingleByMemberId } from "./member-data-store.js";
import { getClientBudgetPg } from "./clients-postgres.service.js";
import { publishChange } from "../../modules/realtime/change-bus.js";
import {
  syncManagementParentsOfProject,
  syncManagementProjectMembers,
} from "../../modules/projects/management-rollup.service.js";
import { toStoredIdleTimeSeconds } from "../../modules/projects/idle-time.js";
import { toStoredBreakTimeSeconds } from "../../modules/projects/break-time.js";
import {
  memberHourlyRateInDisplayCurrency,
  memberHourlyRatesInDisplayCurrency,
} from "../currency/member-rate.js";
import { canonicalizeTimeZone, localDayFor } from "../time/timezone-utils.js";
import { budgetPeriodWindow } from "../time/budget-period.js";

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
       id, name, status, billable, disable_activity, allow_project_tracking, restrict_manager_tracking, disable_idle_time,
       idle_time_seconds, break_time_seconds, disable_break_limit, client_id, managers_notes, users_notes, viewers_notes, type, end_date,
       require_task_to_track, restrict_task_creation, require_stop_note, client_can_manage, client_can_track,
       timezone, created_by, updated_by,
       managers_can_edit_budget, managers_can_edit_member_limits, managers_can_edit_members,
       budget_enabled, member_limits_enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24,
               $25,$26,$27,$28,$29)
     RETURNING *`,
    [
      id,
      data.name,
      data.status ?? "active",
      data.billable ?? true,
      data.disableActivity ?? false,
      data.allowProjectTracking ?? true,
      data.restrictManagerTracking === true,
      data.disableIdleTime ?? false,
      toStoredIdleTimeSeconds(data.idleTimeSeconds),
      toStoredBreakTimeSeconds(data.breakTimeSeconds),
      data.disableBreakLimit === true,
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
      data.timezone ?? null,
      uuidOrNull(data.createdBy),
      data.managersCanEditBudget !== false,
      data.managersCanEditMemberLimits !== false,
      data.managersCanEditMembers !== false,
      data.budgetEnabled !== false,
      data.memberLimitsEnabled !== false,
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
    restrictManagerTracking: "restrict_manager_tracking",
    disableIdleTime: "disable_idle_time",
    idleTimeSeconds: "idle_time_seconds",
    breakTimeSeconds: "break_time_seconds",
    disableBreakLimit: "disable_break_limit",
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
    timezone: "timezone",
    managersCanEditBudget: "managers_can_edit_budget",
    managersCanEditMemberLimits: "managers_can_edit_member_limits",
    managersCanEditMembers: "managers_can_edit_members",
    budgetEnabled: "budget_enabled",
    memberLimitsEnabled: "member_limits_enabled",
    updatedBy: "updated_by",
  };
  const RULE_SWITCHES = new Set([
    "managersCanEditBudget",
    "managersCanEditMemberLimits",
    "managersCanEditMembers",
    "budgetEnabled",
    "memberLimitsEnabled",
  ]);
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
            ? toStoredIdleTimeSeconds(patch[key])
            : key === "breakTimeSeconds"
              ? toStoredBreakTimeSeconds(patch[key])
              : key === "clientCanManage" || key === "clientCanTrack" || key === "disableBreakLimit"
                ? patch[key] === true
                : RULE_SWITCHES.has(key)
                  ? patch[key] !== false
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

/**
 * Deleting a project deletes everything that belongs to it, in one
 * transaction - all of it or none of it: its tasks and everything under them,
 * every work session on the project or its tasks along with their
 * screenshots, app and URL logs, integrity flags, history and
 * screenshot-access records, its time entries and progress, and its own links
 * (members, member limits, budgets, clients, teams, sub-projects, invites).
 * Children go first, and nothing relies on a database cascade: a database
 * created by an older schema may not have them.
 *
 * What it keeps:
 * - the apps and sites the project's work used, and their classifications
 *   (apps, activity_categories). Those hold only an app or a site and what it
 *   is - not how any project used it - so they stay for everyone else.
 * - invoices and expenses: financial records in their own right. They stop
 *   pointing at the project instead.
 *
 * Returns who was on the project, so their dashboards can be told.
 */
export async function deleteProjectPg(id, actorId) {
  const rowsOf = (result) => (Array.isArray(result) ? result : result?.rows ?? []);
  const { memberIds, parentIds } = await withTransaction(async (tx) => {
    const run = async (sql, params = []) => rowsOf(await tx.query(sql, params));
    // Screenshots live in the database, so a busy project is a lot of rows -
    // don't let a short default timeout abandon the delete part way.
    await run("SET LOCAL statement_timeout = '300s'");

    const memberIds = (await run("SELECT DISTINCT member_id FROM project_members WHERE project_id = $1", [id])).map(
      (row) => String(row.member_id),
    );
    const parentIds = (
      await run("SELECT parent_project_id FROM project_subprojects WHERE child_project_id = $1", [id])
    ).map((row) => String(row.parent_project_id));
    const taskIds = (await run("SELECT id FROM tasks WHERE project_id = $1", [id])).map((row) => String(row.id));
    const sessionIds = (
      await run("SELECT id FROM activity_sessions WHERE project_id = $1 OR task_id = ANY($2::uuid[])", [id, taskIds])
    ).map((row) => String(row.id));

    // What was captured while working on it. session_id is text on these
    // tables, and a row can also be tied only to one of the project's tasks.
    await run(
      `DELETE FROM screenshot_access_log WHERE screenshot_id IN (
         SELECT id FROM activity_screenshots WHERE session_id = ANY($1::text[]) OR task_id = ANY($2::uuid[])
       )`,
      [sessionIds, taskIds],
    );
    for (const table of ["activity_screenshots", "activity_app_logs", "activity_url_logs"]) {
      await run(`DELETE FROM ${table} WHERE session_id = ANY($1::text[]) OR task_id = ANY($2::uuid[])`, [
        sessionIds,
        taskIds,
      ]);
    }
    await run("DELETE FROM activity_integrity_flags WHERE session_id = ANY($1::text[])", [sessionIds]);
    await run("DELETE FROM activity_session_events WHERE session_id = ANY($1::uuid[])", [sessionIds]);
    await run("DELETE FROM activity_sessions WHERE id = ANY($1::uuid[])", [sessionIds]);

    // Time and progress recorded against it.
    await run("DELETE FROM time_entries WHERE project_id = $1 OR task_id = ANY($2::uuid[])", [id, taskIds]);
    await run("DELETE FROM task_member_progress WHERE project_id = $1 OR task_id = ANY($2::uuid[])", [id, taskIds]);
    await run("DELETE FROM daily_member_task_active_seconds WHERE task_id = ANY($1::uuid[])", [taskIds]);

    // Its tasks, children first.
    for (const table of ["task_assignments", "task_comments", "task_subtasks", "task_attachments", "task_hours"]) {
      await run(`DELETE FROM ${table} WHERE task_id = ANY($1::uuid[])`, [taskIds]);
    }
    await run("DELETE FROM task_assignments WHERE project_id = $1", [id]);
    await run("DELETE FROM tasks WHERE project_id = $1", [id]);

    // Financial records stay, and stop pointing at the project.
    await run("UPDATE invoice_line_items SET project_id = NULL WHERE project_id = $1", [id]);
    await run("UPDATE expenses SET project_id = NULL WHERE project_id = $1", [id]);

    // Its own links, then the project itself.
    for (const table of [
      "project_member_limits",
      "project_members",
      "project_budget_notify_state",
      "project_budgets",
      "client_projects",
      "team_projects",
      "invite_projects",
      "pending_auth_projects",
    ]) {
      await run(`DELETE FROM ${table} WHERE project_id = $1`, [id]);
    }
    await run("DELETE FROM project_subprojects WHERE parent_project_id = $1 OR child_project_id = $1", [id]);
    await run("DELETE FROM projects WHERE id = $1", [id]);
    return { memberIds, parentIds };
  });

  void publishChange("projects", id, "deleted", uuidOrNull(actorId) ?? undefined);
  // A management project rolls its sub-projects' members up; it has one fewer now.
  for (const parentId of parentIds) {
    void syncManagementProjectMembers(parentId, uuidOrNull(actorId)).catch(() => {});
  }
  return { id, memberIds };
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
  // A member limit only means something for someone on the project.
  await query("DELETE FROM project_member_limits WHERE project_id = $1 AND member_id = $2", [projectId, memberId]);
  void publishChange("project-members", projectId, "updated", uuidOrNull(actorId) ?? undefined);
  void syncManagementParentsOfProject(projectId, uuidOrNull(actorId));
}

/**
 * Whether `memberId` is assigned to `projectId` as someone who tracks time on
 * it - a manager or user. Viewers can't track, so they can't have a member
 * limit either. Rows from before project roles existed have no role and count.
 */
export async function isProjectTrackerPg(projectId, memberId) {
  if (!projectId || !memberId) return false;
  const rows = await query(
    `SELECT 1 FROM project_members
     WHERE project_id = $1 AND member_id = $2 AND COALESCE(LOWER(project_role), '') <> 'viewer'
     LIMIT 1`,
    [projectId, memberId],
  );
  return rows.length > 0;
}

export async function listProjectMembersPg(projectId) {
  return query("SELECT * FROM project_members WHERE project_id = $1", [projectId]);
}

/**
 * Sets the project's manager clock-in allow-list in one statement: every
 * `manager`-role row on this project gets `manager_can_track` set to whether
 * its member_id is in `allowedMemberIds`, so the picker's full desired state
 * can just be sent over - same "declarative list, not incremental toggles"
 * shape as syncProjectMembers. Only meaningful once the project's own
 * restrict_manager_tracking switch is on (see isManagerAllowedToTrackPg); it
 * is always saved regardless of that switch so turning it back on later
 * doesn't need the list re-entered.
 */
export async function setManagerTrackingAccessPg(projectId, allowedMemberIds, actorId) {
  const ids = Array.isArray(allowedMemberIds) ? allowedMemberIds.filter(Boolean) : [];
  await query(
    `UPDATE project_members
        SET manager_can_track = (member_id = ANY($2::uuid[])),
            updated_by = COALESCE($3, updated_by)
      WHERE project_id = $1 AND LOWER(COALESCE(project_role, '')) = 'manager'`,
    [projectId, ids, uuidOrNull(actorId)],
  );
  void publishChange("project-members", projectId, "updated", uuidOrNull(actorId) ?? undefined);
}

/**
 * Whether this specific manager may clock in on this project. Only ever
 * consulted for the plain "manager" role (see isManagerRoleName in
 * activity/routes.js) - callers should check project.restrict_manager_tracking
 * first and skip this entirely when it's off, since off means every manager
 * on the project is allowed, same as before this feature existed.
 */
export async function isManagerAllowedToTrackPg(projectId, memberId) {
  if (!projectId || !memberId) return false;
  const rows = await query(
    `SELECT manager_can_track FROM project_members
      WHERE project_id = $1 AND member_id = $2 AND LOWER(COALESCE(project_role, '')) = 'manager'
      LIMIT 1`,
    [projectId, memberId],
  );
  return rows[0]?.manager_can_track === true;
}

/**
 * One member's timezone override for this specific project, or clears it back
 * to inherited (project's own zone, then the member's personal zone - see
 * resolve-time-zone.js) when `timezone` is empty/null. Applies to any project
 * member, not only managers - unlike the tracking allow-list above, this is
 * about which calendar their hours on this project are judged against, which
 * has nothing to do with their role.
 *
 * An unusable zone is rejected rather than silently stored as something that
 * would resolve to UTC - the caller gets a clear error instead of a member
 * quietly landing on the wrong calendar with no indication why.
 */
export async function setProjectMemberTimeZonePg(projectId, memberId, timezone, actorId) {
  const raw = typeof timezone === "string" ? timezone.trim() : "";
  let stored = null;
  if (raw) {
    const canonical = canonicalizeTimeZone(raw);
    if (canonical === "UTC" && raw !== "UTC") {
      throw new Error(`"${raw}" is not a recognized timezone.`);
    }
    stored = canonical;
  }
  const rows = await query(
    `UPDATE project_members
        SET timezone = $3, updated_by = COALESCE($4, updated_by)
      WHERE project_id = $1 AND member_id = $2
      RETURNING id`,
    [projectId, memberId, stored, uuidOrNull(actorId)],
  );
  if (rows.length === 0) {
    throw new Error("This member is not on this project.");
  }
  void publishChange("project-members", projectId, "updated", uuidOrNull(actorId) ?? undefined);
  return stored;
}

/** Every member on this project with a timezone override set, keyed by member id - for hydrating the project editor without an extra round trip per member. */
export async function listProjectMemberTimeZonesPg(projectId) {
  const rows = await query(
    `SELECT member_id, timezone FROM project_members WHERE project_id = $1 AND timezone IS NOT NULL`,
    [projectId],
  );
  return Object.fromEntries(rows.map((row) => [row.member_id, row.timezone]));
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


/**
 * The project's budget as everything that *uses* a budget should see it: none at
 * all while the project's Management tab has "Use a budget" off. The row is kept
 * (getProjectBudgetRowPg still reads it), so switching it back on restores it.
 */
export async function getProjectBudgetPg(projectId) {
  const rows = await query(
    `SELECT b.* FROM project_budgets b
       JOIN projects p ON p.id = b.project_id
      WHERE b.project_id = $1 AND p.budget_enabled IS NOT FALSE
      LIMIT 1`,
    [projectId],
  );
  return rows[0] ?? null;
}

/** The stored budget row whatever the switch says - for editing it, never for enforcing it. */
export async function getProjectBudgetRowPg(projectId) {
  const rows = await query("SELECT * FROM project_budgets WHERE project_id = $1 LIMIT 1", [projectId]);
  return rows[0] ?? null;
}

export async function getAllProjectBudgetsPg() {
  return query(
    `SELECT b.* FROM project_budgets b
       JOIN projects p ON p.id = b.project_id
      WHERE p.budget_enabled IS NOT FALSE`,
  );
}

export async function upsertProjectBudgetPg(projectId, data, actorId, expectedUpdatedAt) {
  // The raw row: a budget switched off still exists, and must be updated, not duplicated.
  const existing = await getProjectBudgetRowPg(projectId);

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
      return { conflict: true, current: await getProjectBudgetRowPg(projectId) };
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


/**
 * Member limits as everything that enforces or reports them should see them:
 * none while the project's Management tab has "Use member limits" off. The rows
 * are kept, so switching it back on restores them.
 */
export async function getProjectMemberLimitPg(projectId, memberId) {
  const rows = await query(
    `SELECT l.* FROM project_member_limits l
       JOIN projects p ON p.id = l.project_id
      WHERE l.project_id = $1 AND l.member_id = $2 AND p.member_limits_enabled IS NOT FALSE
      LIMIT 1`,
    [projectId, memberId],
  );
  return rows[0] ?? null;
}

export async function listProjectMemberLimitsPg(projectId) {
  return query(
    `SELECT l.* FROM project_member_limits l
       JOIN projects p ON p.id = l.project_id
      WHERE l.project_id = $1 AND p.member_limits_enabled IS NOT FALSE`,
    [projectId],
  );
}

export async function getAllProjectMemberLimitsPg() {
  return query(
    `SELECT l.* FROM project_member_limits l
       JOIN projects p ON p.id = l.project_id
      WHERE p.member_limits_enabled IS NOT FALSE`,
  );
}

export async function resolveMemberHourlyRatePg(db, projectId, memberId, basedOn) {
  if (String(basedOn || "").toLowerCase().includes("pay")) {
    // In the workspace currency: members are paid in their own, and a budget
    // is one number.
    return Math.max(0, await memberHourlyRateInDisplayCurrency(memberId, db));
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
  // The one door every member limit comes through (the project routes and the
  // generic entity CRUD both call this): limits are only for members assigned
  // to the project.
  if (!(await isProjectTrackerPg(projectId, memberId))) {
    throw Object.assign(
      new Error("Only members assigned to this project (as a manager or user) can have a member limit."),
      { status: 400, code: "MEMBER_NOT_ON_PROJECT" },
    );
  }
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

  // The day a session counts on is the day it started in `options.timeZone`
  // (the project's calendar for its limits); without one it is the database
  // session's, which is UTC - right only for people living there.
  let sessionDay = "started_at::date";
  if (options.timeZone) {
    params.push(options.timeZone);
    sessionDay = `(started_at AT TIME ZONE $${params.length}::text)::date`;
  }

  if (options.fromDate) {
    params.push(options.fromDate);
    sessionWhere += ` AND ${sessionDay} >= $${params.length}`;
    params.push(options.fromDate);
    entryWhere += ` AND date >= $${params.length}`;
  }
  if (options.toDate) {
    params.push(options.toDate);
    sessionWhere += ` AND ${sessionDay} <= $${params.length}`;
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
  // Same rule as getProjectTrackedSecondsPg: a session counts on the day it started in
  // `options.timeZone` (the project's calendar), else in the database's (UTC).
  let sessionDay = "started_at::date";
  if (options.timeZone) {
    params.push(options.timeZone);
    sessionDay = `(started_at AT TIME ZONE $${params.length}::text)::date`;
  }
  if (options.fromDate) {
    params.push(options.fromDate);
    sessionDateClause += ` AND ${sessionDay} >= $${params.length}`;
    entryDateClause += ` AND date >= $${params.length}`;
  }
  if (options.toDate) {
    params.push(options.toDate);
    sessionDateClause += ` AND ${sessionDay} <= $${params.length}`;
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
    const rateByMember = await memberHourlyRatesInDisplayCurrency(
      rows.map((row) => row.member_id),
      db,
    );
    let total = 0;
    for (const row of rows) {
      const hours = Math.max(0, Number(row.secs ?? 0)) / 3600;
      if (hours <= 0) continue;
      const rate = rateByMember.get(String(row.member_id)) ?? 0;
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
    timeZone: options.timeZone,
  });
  const hours = seconds / 3600;
  return Math.round(hours * rate * 100) / 100;
}

/** A project's own calendar for its budget periods: its declared zone, else UTC. */
function projectBudgetZone(raw) {
  const declared = typeof raw === "string" ? raw.trim() : "";
  return declared ? canonicalizeTimeZone(declared) : "UTC";
}

/**
 * What a whole-project budget has spent each day from `fromDay`, in the budget's own unit (hours for
 * an Hours based budget, money for a Cost based one), with each day cut in the project's calendar.
 * This is what "When used up" walks to find where a period ends - see lib/time/budget-period.js.
 * Same sources and rules as the spend totals: tracked sessions plus approved manual entries, billable
 * only when the budget says so, money from pay rates or the client's bill rate.
 */
export async function dailyBudgetSpendPg(db, projectId, budgetRow, zone, fromDay, toDay = null) {
  const params = [projectId, zone, fromDay];
  let sessionTo = "";
  let entryTo = "";
  if (toDay) {
    params.push(toDay);
    sessionTo = ` AND (started_at AT TIME ZONE $2::text)::date <= $${params.length}`;
    entryTo = ` AND date <= $${params.length}`;
  }
  const billable = budgetRow.include_non_billable_time === false ? " AND billable = true" : "";
  const rows = await query(
    `SELECT day, member_id, SUM(secs) AS secs FROM (
       SELECT to_char((started_at AT TIME ZONE $2::text)::date, 'YYYY-MM-DD') AS day, member_id, active_seconds AS secs
         FROM activity_sessions
        WHERE project_id = $1 AND (started_at AT TIME ZONE $2::text)::date >= $3::date${sessionTo}
       UNION ALL
       SELECT to_char(date, 'YYYY-MM-DD') AS day, member_id, duration AS secs
         FROM time_entries
        WHERE project_id = $1 AND status != 'rejected' AND date >= $3::date${entryTo}${billable}
     ) tracked
     GROUP BY day, member_id`,
    params,
  );

  const isHours = String(budgetRow.type) === "Hours based";
  const basedOnPay = String(budgetRow.based_on || "").toLowerCase().includes("pay");
  let rateForMember = () => 1;
  if (!isHours) {
    if (basedOnPay) {
      const rates = await memberHourlyRatesInDisplayCurrency([...new Set(rows.map((r) => r.member_id))], db);
      rateForMember = (memberId) => rates.get(String(memberId)) ?? 0;
    } else {
      const clientIds = await listClientIdsForProjectPg(projectId);
      const clientRate = clientIds.length ? Number((await getClientBudgetPg(clientIds[0]))?.cost ?? 0) : 0;
      rateForMember = () => clientRate;
    }
  }
  const daily = new Map();
  for (const row of rows) {
    const hours = Math.max(0, Number(row.secs ?? 0)) / 3600;
    const amount = isHours ? hours : hours * rateForMember(row.member_id);
    if (amount > 0) daily.set(row.day, (daily.get(row.day) ?? 0) + amount);
  }
  return daily;
}

/**
 * Each budgeted project's spend window right now (lib/time/budget-period.js), from the stored
 * budget - so a caller that passes only start/end still gets the reset period applied.
 * "When used up" budgets walk their day-by-day spend to find where the current period began.
 */
export async function budgetWindowsForProjectsPg(projectIds, now = new Date(), db = null) {
  const ids = [...new Set((projectIds ?? []).filter(Boolean).map(String))];
  const out = new Map();
  if (ids.length === 0) return out;
  const rows = await query(
    `SELECT pb.project_id, pb.resets, pb.start_date, pb.end_date, pb.cost, pb.type, pb.based_on, pb.scope,
            pb.include_non_billable_time, p.timezone
       FROM project_budgets pb
       JOIN projects p ON p.id = pb.project_id
      WHERE pb.project_id = ANY($1::uuid[])`,
    [ids],
  );
  for (const row of rows ?? []) {
    const zone = projectBudgetZone(row.timezone);
    const todayDay = localDayFor(now, zone);
    let dailySpend = null;
    // Only whole-project budgets: a per-person budget would have to be walked person by person.
    if (
      String(row.resets ?? "").trim().toLowerCase() === "when used up" &&
      row.scope !== "per_person" &&
      Number(row.cost) > 0 &&
      row.start_date
    ) {
      const start = toDayStrOrNull(row.start_date);
      const end = toDayStrOrNull(row.end_date);
      dailySpend = await dailyBudgetSpendPg(db, row.project_id, row, zone, start, end && end < todayDay ? end : todayDay);
    }
    out.set(String(row.project_id), { ...budgetPeriodWindow(row, todayDay, { dailySpend }), zone });
  }
  return out;
}

export async function computeProjectSpentPg(db, projectId, budgetRow) {
  if (!budgetRow) return 0;
  const includeNonBillable = budgetRow.include_non_billable_time !== false;
  // Only the current period counts when the budget resets (see budget-period.js).
  const window = (await budgetWindowsForProjectsPg([projectId], new Date(), db)).get(String(projectId));
  const fromDate = window ? window.fromDay : toDayStrOrNull(budgetRow.start_date);
  const toDate = window ? window.toDay : toDayStrOrNull(budgetRow.end_date);
  const timeZone = window?.zone;
  if (String(budgetRow.type) === "Hours based") {
    const seconds = await getProjectTrackedSecondsPg(projectId, { includeNonBillable, fromDate, toDate, timeZone });
    return Math.round((seconds / 3600) * 100) / 100;
  }
  return computeProjectSpentCostPg(db, projectId, {
    fromDate,
    toDate,
    timeZone,
    basedOn: budgetRow.based_on,
    includeNonBillable,
  });
}

export async function computeProjectSpentForAllPg(db, budgetRows) {
  const result = new Map();
  if (!budgetRows.length) return result;

  // The current period of each budget, from the stored row - several callers build these rows
  // by hand with only start/end, so the reset period is looked up here rather than trusted to them.
  const windows = await budgetWindowsForProjectsPg(budgetRows.map((r) => r.id), new Date(), db);
  budgetRows = budgetRows.map((r) => {
    const w = windows.get(String(r.id));
    return w ? { ...r, start_date: w.fromDay, end_date: w.toDay, zone: w.zone } : { ...r, zone: "UTC" };
  });

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
    const zones = rows.map((r) => r.zone || "UTC");
    const dbRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[], $3::date[], $4::date[], $5::text[]) AS t(project_id, include_non_billable, start_date, end_date, zone)
       )
       SELECT project_id, SUM(secs) AS total_seconds FROM (
         SELECT s.project_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         WHERE (f.start_date IS NULL OR (s.started_at AT TIME ZONE f.zone)::date >= f.start_date)
           AND (f.end_date IS NULL OR (s.started_at AT TIME ZONE f.zone)::date <= f.end_date)
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
      [ids, includeFlags, startDates, endDates, zones],
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
    const zones = payRateCostRows.map((r) => r.zone || "UTC");
    const memberRows = await query(
      `WITH proj_flags AS (
         SELECT * FROM UNNEST($1::uuid[], $2::boolean[], $3::date[], $4::date[], $5::text[]) AS t(project_id, include_non_billable, start_date, end_date, zone)
       )
       SELECT project_id, member_id, SUM(secs) AS secs FROM (
         SELECT s.project_id, s.member_id, s.active_seconds AS secs
         FROM activity_sessions s
         JOIN proj_flags f ON f.project_id = s.project_id
         WHERE (f.start_date IS NULL OR (s.started_at AT TIME ZONE f.zone)::date >= f.start_date)
           AND (f.end_date IS NULL OR (s.started_at AT TIME ZONE f.zone)::date <= f.end_date)
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
      [ids, includeFlags, startDates, endDates, zones],
    );
    const distinctMemberIds = [...new Set(memberRows.map((r) => r.member_id))];
    const rateByMember = await memberHourlyRatesInDisplayCurrency(distinctMemberIds, db);
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
  // Only people who can clock in count: a per-person budget is spent by tracked
  // time, so viewers - and managers the project keeps from clocking in - add
  // nothing to it (see project-trackers.js).
  const memberRows = await query(
    `SELECT pm.project_id, pm.member_id, pm.project_role, pm.manager_can_track,
            p.allow_project_tracking, p.restrict_manager_tracking
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
      WHERE pm.project_id = ANY($1::uuid[])`,
    [ids],
  );
  const membersByProject = new Map();
  for (const row of memberRows) {
    if (!isProjectTrackerRow(row)) continue;
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
    const rateByMember = await memberHourlyRatesInDisplayCurrency(distinctMemberIds, db);
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
