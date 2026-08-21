import { assertManagementRole, canAccessMember } from "../../http/authorization.js";
import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import {
  assertProjectAccessible,
  getViewerProjectIds,
  toAllowedProjectSet,
  viewerCanWriteProject,
} from "../../http/project-access.js";
import { canEditTeam } from "../../http/team-edit-access.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { sendPgConstraintError } from "../../http/api-error.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { listClientsEnriched } from "../clients/services/client-service.js";
import { enrichMembersWithRoleNames } from "../members/services/relation-sync.js";
import { getOverviewCore, getOverviewPanels } from "./services/overview-service.js";
import { PROJECT_FORM_FIELDS, PROJECT_FORM_TABS } from "./form-config.js";
import { memberDisplayLabel } from "../members/services/member-display-name.js";
import {
  createProjectPg,
  getProjectPg,
  updateProjectPg,
  archiveProjectPg,
  deleteProjectPg,
  listProjectsPg,
  addProjectMemberPg,
  removeProjectMemberPg,
  listProjectMembersPg,
  getProjectBudgetPg,
  getAllProjectBudgetsPg,
  upsertProjectBudgetPg,
  computeProjectSpentPg,
  computeProjectBudgetTargetPg,
  computeProjectSpentForAllPg,
  computeProjectBudgetTargetForAllPg,
  getProjectTrackedSecondsPg,
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
} from "../../lib/postgres/projects-postgres.service.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { sendToMember } from "../presence/index.js";
import { schemaByKey } from "../schema/catalog/index.js";
import { buildCreatePayload, buildUpdatePayload } from "../schema/services/schema-crud.service.js";
import { computeMinimumProjectDaysPg, computeMinimumEndDate } from "./services/project-budget-capacity.js";

/** Field-type coercion + unknown-field rejection, reusing the same catalog
 * validation the old generic Firestore path used (schema/catalog/projects) -
 * not reinvented, just applied as a gate before the values that were already
 * being read manually below. Throws (message becomes the 400 response) on a
 * bad field name or wrong type. */
function validateProjectDomainBody(entityKey, body, isUpdate) {
  const entity = schemaByKey.get(entityKey);
  if (!entity) return;
  // §6.9 optimistic-concurrency token: sent by the client on updates, never
  // a real column, so the field catalog doesn't (and shouldn't) know about
  // it - every isUpdate caller needs it whitelisted or it 400s as an
  // "Unexpected field" before the conditional-write check below ever runs.
  const options = isUpdate ? { extraAllowedFields: ["expected_updated_at", "expectedUpdatedAt"] } : {};
  if (isUpdate) buildUpdatePayload(entity, body, options);
  else buildCreatePayload(entity, body, options);
}

/**
 * Real gate for the End Date x per-person-budget feasibility check: a
 * scope='per_person' budget's `cost` is hours every member must independently
 * log, throttled by each member's own daily/weekly cap (Members page) - the
 * project can't finish before the slowest-capped member could possibly reach
 * that many hours. No-op (returns true) when there's no end date to check
 * against, or the budget isn't per_person, or nothing constrains it.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ id: string, created_at: string|Date, end_date: string|Date|null }} project
 * @param {string} scope
 * @param {number} hoursPerPerson
 * @returns {Promise<string|null>} null if feasible, else an error message
 */
async function checkBudgetEndDateFeasible(db, project, scope, hoursPerPerson) {
  if (scope !== "per_person" || !project?.end_date) return null;
  const { minDays } = await computeMinimumProjectDaysPg(db, project.id, Number(hoursPerPerson));
  if (minDays <= 0) return null;
  const minEndDate = computeMinimumEndDate(project.created_at, minDays);
  const chosenEndDate = new Date(project.end_date);
  if (chosenEndDate < minEndDate) {
    const dayWord = minDays === 1 ? "day" : "days";
    return (
      `End date is too early: at least one member's daily/weekly hour limit needs ${minDays} ${dayWord} ` +
      `to reach ${hoursPerPerson} hours per person. Earliest feasible end date is ${minEndDate.toISOString().slice(0, 10)}.`
    );
  }
  return null;
}

function memberLabel(data) {
  return memberDisplayLabel(data);
}

export const PROJECT_TYPES = ["normal", "calling"];

/** Throws on an unrecognized value; message becomes the 400 response. */
function normalizeProjectType(value) {
  if (value === undefined || value === null || value === "") return "normal";
  const type = String(value).trim().toLowerCase();
  if (!PROJECT_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${PROJECT_TYPES.join(", ")}`);
  }
  return type;
}

function normalizeProjectRole(role) {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  if (value === "managers" || value === "manager") return "manager";
  if (value === "users" || value === "user") return "user";
  if (value === "viewers" || value === "viewer") return "viewer";
  if (value === "members" || value === "member") return "member";
  return value || "member";
}

function toIso(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeProjects(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/projects/overview" && req.method === "GET") {
    try {
      const viewer = getAuthContext(req);
      const allowed = viewer
        ? toAllowedProjectSet(await getViewerProjectIds(db, viewer.memberId, viewer.roleName))
        : null;
      const data = await getOverviewCore(db, { allowedProjectIds: allowed });
      sendJson(res, origin, 200, { success: true, data }, req);
    } catch (e) {
      logSafeError("[projects/overview]", e);
      sendJson(
        res,
        origin,
        500,
        { success: false, error: e instanceof Error ? e.message : "Failed to load project overview" },
        req,
      );
    }
    return true;
  }

  if (pn === "/api/projects/overview/panels" && req.method === "GET") {
    try {
      const viewer = getAuthContext(req);
      const allowed = viewer
        ? toAllowedProjectSet(await getViewerProjectIds(db, viewer.memberId, viewer.roleName))
        : null;
      const taskLimit = Number.parseInt(url.searchParams.get("task_limit") ?? "80", 10);
      const data = await getOverviewPanels(db, { taskLimit, allowedProjectIds: allowed });
      sendJson(res, origin, 200, { success: true, data }, req);
    } catch (e) {
      logSafeError("[projects/overview/panels]", e);
      sendJson(
        res,
        origin,
        500,
        {
          success: false,
          error: e instanceof Error ? e.message : "Failed to load overview panels",
        },
        req,
      );
    }
    return true;
  }

  if (pn === "/api/projects/team-links" && req.method === "GET") {
    try {
      const viewer = getAuthContext(req);
      const allowed = viewer
        ? toAllowedProjectSet(await getViewerProjectIds(db, viewer.memberId, viewer.roleName))
        : null;
      const linkRows = await pgQuery("SELECT id, team_id, project_id FROM team_projects");
      const teamIds = [...new Set(linkRows.map((row) => String(row.team_id || "").trim()).filter(Boolean))];

      const teamNameById = new Map();
      if (teamIds.length > 0) {
        const teamRows = await pgQuery("SELECT id, name FROM teams WHERE id = ANY($1)", [teamIds]);
        for (const row of teamRows) {
          teamNameById.set(
            row.id,
            typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Unnamed team",
          );
        }
      }

      const data = linkRows.flatMap((row) => {
        const projectId = String(row.project_id || "").trim();
        if (allowed !== null && projectId && !allowed.has(projectId)) return [];
        const teamId = String(row.team_id || "").trim();
        return [{
          id: row.id,
          project_id: projectId,
          team_id: teamId,
          team_name: teamNameById.get(teamId) ?? teamId,
        }];
      });

      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[projects/team-links]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load team links",
      });
    }
    return true;
  }

  const projectTeamsMatch = /^\/api\/projects\/([^/]+)\/teams$/.exec(pn);
  if (projectTeamsMatch && req.method === "GET") {
    const projectId = projectTeamsMatch[1];
    if (!(await assertProjectAccessible(req, res, origin, db, projectId))) return true;
    try {
      const project = await getProjectPg(projectId);
      if (!project) {
        sendJson(res, origin, 404, { success: false, error: "Project not found" });
        return true;
      }

      const teamIds = await listTeamIdsForProjectPg(projectId);

      const teams = [];
      if (teamIds.length > 0) {
        const teamRows = await pgQuery("SELECT id, name FROM teams WHERE id = ANY($1)", [teamIds]);
        for (const row of teamRows) {
          teams.push({
            id: row.id,
            name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Unnamed team",
          });
        }
      }

      teams.sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, origin, 200, { success: true, data: teams });
    } catch (e) {
      logSafeError("[projects/teams]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load project teams",
      });
    }
    return true;
  }

  // Live remaining-time number for an Hours-based project budget - the
  // team-wide gate (checkProjectBudgetCap in activity/routes.js) has always
  // enforced this silently, but never surfaced an actual number for the
  // desktop agent to show. Cost-based budgets are a dollar unit, not a
  // countdown - deliberately not handled here, same as a missing budget.
  const projectBudgetStatusMatch = /^\/api\/projects\/([^/]+)\/budget-status$/.exec(pn);
  if (projectBudgetStatusMatch && req.method === "GET") {
    const projectId = projectBudgetStatusMatch[1];
    if (!(await assertProjectAccessible(req, res, origin, db, projectId))) return true;
    const viewer = getAuthContext(req);
    try {
      const budget = await getProjectBudgetPg(projectId);
      if (!budget || budget.type !== "Hours based") {
        sendJson(res, origin, 200, { success: true, data: null });
        return true;
      }
      const perPerson = budget.scope === "per_person";
      const [capSeconds, spentSeconds] = await Promise.all([
        perPerson
          ? Promise.resolve(Math.floor(Number(budget.cost ?? 0) * 3600))
          : computeProjectBudgetTargetPg(db, projectId, budget).then((hours) => Math.floor(hours * 3600)),
        perPerson
          ? getProjectTrackedSecondsPg(projectId, {
              memberId: viewer.memberId,
              includeNonBillable: budget.include_non_billable_time !== false,
            })
          : computeProjectSpentPg(db, projectId, budget).then((hours) => Math.floor(hours * 3600)),
      ]);
      sendJson(res, origin, 200, {
        success: true,
        data: {
          scope: perPerson ? "per_person" : "shared",
          capSeconds,
          spentSeconds,
          remainingSeconds: Math.max(0, capSeconds - spentSeconds),
        },
      });
    } catch (e) {
      logSafeError("[projects/budget-status]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load project budget status",
      });
    }
    return true;
  }

  const editStateMatch = /^\/api\/projects\/([^/]+)\/edit-state$/.exec(pn);
  if (editStateMatch && req.method === "GET") {
    const projectId = editStateMatch[1];
    if (!(await assertProjectAccessible(req, res, origin, db, projectId))) return true;
    try {
      const [project, memberRows, teamIdsRaw, clientIdRows, budgetRows, limitRows] = await Promise.all([
        getProjectPg(projectId),
        listProjectMembersPg(projectId),
        listTeamIdsForProjectPg(projectId),
        listClientIdsForProjectPg(projectId),
        pgQuery("SELECT * FROM project_budgets WHERE project_id = $1", [projectId]),
        pgQuery("SELECT * FROM project_member_limits WHERE project_id = $1", [projectId]),
      ]);

      if (!project) {
        sendJson(res, origin, 404, { success: false, error: "Project not found" });
        return true;
      }

      const managerIds = [];
      const userIds = [];
      const viewerIds = [];

      const pushUnique = (list, id) => {
        if (id && !list.includes(id)) list.push(id);
      };
      for (const row of memberRows) {
        const memberId = String(row.member_id || "").trim();
        if (!memberId) continue;
        const role = normalizeProjectRole(row.project_role);
        if (role === "member") continue;
        if (role === "manager") pushUnique(managerIds, memberId);
        else if (role === "user") pushUnique(userIds, memberId);
        else if (role === "viewer") pushUnique(viewerIds, memberId);
      }

      const teamIds = teamIdsRaw.map((id) => String(id || "").trim()).filter(Boolean);

      const budget = budgetRows[0] ?? null;
      const limit = limitRows[0] ?? null;

      const clientIdsFromLinks = clientIdRows.map((id) => String(id || "").trim()).filter(Boolean);

      const primaryClientId = String(project.client_id || project.clientId || "").trim();
      const clientIds =
        clientIdsFromLinks.length > 0
          ? [...new Set(clientIdsFromLinks)]
          : primaryClientId
            ? [primaryClientId]
            : [];

      sendJson(res, origin, 200, {
        success: true,
        data: {
          name: String(project.name || ""),
          type: String(project.type || "normal"),
          billable: Boolean(project.billable),
          disableActivity: Boolean(project.disable_activity ?? project.disableActivity),
          allowProjectTracking: Boolean(
            project.allow_project_tracking ?? project.allowProjectTracking ?? true,
          ),
          disableIdleTime: Boolean(project.disable_idle_time ?? project.disableIdleTime),
          idleTimeSeconds: Number(project.idle_time_seconds ?? project.idleTimeSeconds ?? 450),
          endDate: toIso(project.end_date || project.endDate).slice(0, 10),
          clientIds,
          teamIds,
          managerIds,
          userIds,
          viewerIds,
          memberLimitMemberIds:
            limit && (limit.member_id || limit.memberId)
              ? [String(limit.member_id || limit.memberId)]
              : [],
          budgetStopTimers: budget
            ? Boolean(budget.stop_timers_when_reached ?? budget.stopTimersWhenReached ?? true)
            : true,
          budgetId: budget ? String(budget.id) : undefined,
          /** Optimistic-concurrency token (§6.9) - sent back unchanged on save. */
          budgetUpdatedAt: budget ? toIso(budget.updated_at) : undefined,
          budgetType: budget ? String(budget.type || "") : "",
          budgetBasedOn: budget ? String(budget.based_on || budget.basedOn || "") : "",
          budgetScope: budget && budget.scope === "per_person" ? "per_person" : "per_project",
          budgetTotal: budget ? String(budget.cost ?? 0) : "5000",
          budgetResets: budget ? String(budget.resets || "Never") : "Never",
          budgetNotifyAt:
            budget && budget.notify_at_pct != null
              ? String(budget.notify_at_pct)
              : budget && budget.notifyAtPct != null
                ? String(budget.notifyAtPct)
                : "",
          budgetWhoToNotify: budget ? String(budget.who_to_notify || budget.whoToNotify || "") : "",
          budgetStopTimersAt:
            budget && budget.stop_timers_at_pct != null
              ? String(budget.stop_timers_at_pct)
              : budget && budget.stopTimersAtPct != null
                ? String(budget.stopTimersAtPct)
                : "",
          budgetStartDate: budget ? toIso(budget.start_date || budget.startDate).slice(0, 10) : "",
          budgetIncludeNonBillable: budget
            ? Boolean(budget.include_non_billable_time ?? budget.includeNonBillableTime ?? true)
            : true,
          budgetNotifyMembers: budget
            ? Boolean(budget.notify_project_members ?? budget.notifyProjectMembers)
            : false,
          memberLimitType: limit ? String(limit.type || "") : "",
          memberLimitBasedOn: limit ? String(limit.based_on || limit.basedOn || "") : "",
          memberLimitResets: limit ? String(limit.resets || "Never") : "Never",
          memberLimitStartDate: limit ? toIso(limit.start_date || limit.startDate).slice(0, 10) : "",
          memberLimitNotifyAt:
            limit && limit.notify_at_pct != null
              ? String(limit.notify_at_pct)
              : limit && limit.notifyAtPct != null
                ? String(limit.notifyAtPct)
                : "80",
          memberLimitNotifyMembers: limit
            ? Boolean(limit.notify_project_members ?? limit.notifyProjectMembers ?? true)
            : true,
          memberLimitMembers: limit ? String(limit.cost ?? 0) : "",
          budgetSpent: 0,
          // Optimistic-concurrency version token (§6.9) - sent back
          // unchanged on save so a stale-snapshot write can be detected
          // instead of silently overwriting whatever changed in between.
          updatedAt: toIso(project.updated_at),
        },
      });
    } catch (e) {
      logSafeError("[projects/edit-state]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load project for edit",
      });
    }
    return true;
  }

  if (pn === "/api/projects/form-config" && req.method === "GET") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const [clientRows, memberRows] = await Promise.all([
        listClientsEnriched(db),
        listMembersPg({ limit: 500 }),
      ]);

      const clients = clientRows
        .filter((c) => c.status !== "archived")
        .map((c) => ({
          id: c.id,
          label: typeof c.name === "string" && c.name.trim() ? c.name.trim() : "Unnamed client",
          budget: c.budget ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const rawMembers = memberRows
        .map((d) => {
          const status = typeof d.status === "string" ? d.status.toLowerCase() : "active";
          if (status === "archived" || status === "inactive") return null;
          return { id: String(d.id), ...d };
        })
        .filter(Boolean);

      const enrichedMembers = await enrichMembersWithRoleNames(db, rawMembers);

      const members = enrichedMembers
        .map((m) => {
          const { name, initials } = memberLabel(m);
          const role =
            typeof m.role === "string" && m.role.trim()
              ? m.role.trim()
              : typeof m.role_name === "string" && m.role_name.trim()
                ? m.role_name.trim()
                : "Viewer";
          return { id: m.id, label: name, initials, role };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      sendJson(res, origin, 200, {
        success: true,
        data: {
          tabs: PROJECT_FORM_TABS,
          fields: PROJECT_FORM_FIELDS,
          options: { clients, members },
        },
      });
    } catch (e) {
      logSafeError("[projects/form-config]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load project form config",
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Projects-domain CRUD (Postgres-backed). See
  // PROPOSAL-Projects-Migration-to-PostgreSQL.md. Mirrors the same
  // authorization semantics as the old generic Firestore path
  // (assertProjectWriteAuthorized / assertTeamWriteAuthorized in
  // schema/routes.js) - different storage engine, not a permissions change.
  //
  // NOT dual-write: these write Postgres only. Firestore stops receiving new
  // project-domain data the moment this ships, which means any consumer still
  // reading Firestore directly for this domain (there are several - see the
  // migration doc) goes stale from this point on. That's a known, deliberate
  // gap in this pass, not an oversight - flagged rather than silently patched
  // over with a partial dual-write that wouldn't have full validation parity.
  // ---------------------------------------------------------------------------

  async function assertProjectDomainWrite(projectId, memberId) {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return null;
    }
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
      return null;
    }
    if (projectId) {
      const allowed = await viewerCanWriteProject(db, viewer, projectId);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "Cannot modify projects outside your access scope." });
        return null;
      }
    }
    if (memberId) {
      const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, memberId);
      if (!allowed) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Cannot modify project membership outside your access scope.",
        });
        return null;
      }
    }
    return viewer;
  }

  async function assertTeamProjectWrite(teamId) {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return null;
    }
    if (requireManagementRole(viewer)) return viewer;
    if (teamId && (await canEditTeam(db, viewer.memberId, viewer.roleName, teamId))) return viewer;
    sendJson(res, origin, 403, {
      success: false,
      error: "Only the organization Owner or team leads can edit this team.",
    });
    return null;
  }

  async function scopedRows(rows, projectIdKey = "project_id") {
    const viewer = getAuthContext(req);
    if (!viewer) return rows;
    const allowed = toAllowedProjectSet(await getViewerProjectIds(db, viewer.memberId, viewer.roleName));
    if (allowed === null) return rows;
    return rows.filter((r) => allowed.has(r[projectIdKey]));
  }

  // ─── /api/projects ────────────────────────────────────────────────────
  if (pn === "/api/projects" && req.method === "GET") {
    try {
      const projectIdFilter = url.searchParams.get("project_id");
      let rows = projectIdFilter ? [await getProjectPg(projectIdFilter)].filter(Boolean) : await listProjectsPg({ limit: 500 });
      rows = await scopedRows(rows, "id");
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[projects GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load projects" });
    }
    return true;
  }

  if (pn === "/api/projects" && req.method === "POST") {
    try {
      const viewer = await assertProjectDomainWrite(null, null);
      if (!viewer) return true;
      const body = await readJsonBody(req);
      validateProjectDomainBody("projects", body, false);
      const project = await createProjectPg({
        name: body.name,
        status: body.status,
        billable: body.billable,
        disableActivity: body.disable_activity ?? body.disableActivity,
        allowProjectTracking: body.allow_project_tracking ?? body.allowProjectTracking,
        disableIdleTime: body.disable_idle_time ?? body.disableIdleTime,
        idleTimeSeconds: body.idle_time_seconds ?? body.idleTimeSeconds,
        clientId: body.client_id ?? body.clientId,
        managersNotes: body.managers_notes ?? body.managersNotes,
        usersNotes: body.users_notes ?? body.usersNotes,
        viewersNotes: body.viewers_notes ?? body.viewersNotes,
        type: normalizeProjectType(body.type),
        endDate: body.end_date ?? body.endDate,
        createdBy: body.created_by ?? body.createdBy ?? viewer.memberId,
      });
      sendJson(res, origin, 200, { success: true, data: project });
    } catch (e) {
      logSafeError("[projects POST]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to create project" });
    }
    return true;
  }

  const projectIdMatch = /^\/api\/projects\/([^/]+)$/.exec(pn);
  if (projectIdMatch) {
    const projectId = projectIdMatch[1];

    if (req.method === "GET") {
      try {
        if (!(await assertProjectAccessible(req, res, origin, db, projectId))) return true;
        const project = await getProjectPg(projectId);
        if (!project) {
          sendJson(res, origin, 404, { success: false, error: "Project not found" });
          return true;
        }
        sendJson(res, origin, 200, { success: true, data: project });
      } catch (e) {
        logSafeError("[projects/:id GET]", e);
        sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load project" });
      }
      return true;
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      try {
        const viewer = await assertProjectDomainWrite(projectId, null);
        if (!viewer) return true;
        const body = await readJsonBody(req);
        validateProjectDomainBody("projects", body, true);
        // Type decides whether the project tracks time via tasks at all -
        // flipping it on a project that already has task history (or calling
        // sessions) would orphan that data, so it is create-time only.
        if (body.type !== undefined) {
          const existing = await getProjectPg(projectId);
          if (existing && normalizeProjectType(body.type) !== String(existing.type || "normal")) {
            sendJson(res, origin, 400, {
              success: false,
              error: "Project type cannot be changed after creation.",
            });
            return true;
          }
        }
        const nextEndDate = body.end_date ?? body.endDate;
        if (nextEndDate !== undefined) {
          const [existingProject, existingBudget] = await Promise.all([
            getProjectPg(projectId),
            getProjectBudgetPg(projectId),
          ]);
          if (existingProject && existingBudget?.scope === "per_person" && Number(existingBudget.cost) > 0) {
            const endDateError = await checkBudgetEndDateFeasible(
              db,
              { id: projectId, created_at: existingProject.created_at, end_date: nextEndDate },
              existingBudget.scope,
              existingBudget.cost,
            );
            if (endDateError) {
              sendJson(res, origin, 400, { success: false, error: endDateError });
              return true;
            }
          }
        }
        const patch = {
          name: body.name,
          status: body.status,
          billable: body.billable,
          disableActivity: body.disable_activity ?? body.disableActivity,
          allowProjectTracking: body.allow_project_tracking ?? body.allowProjectTracking,
          disableIdleTime: body.disable_idle_time ?? body.disableIdleTime,
          idleTimeSeconds: body.idle_time_seconds ?? body.idleTimeSeconds,
          clientId: body.client_id ?? body.clientId,
          managersNotes: body.managers_notes ?? body.managersNotes,
          usersNotes: body.users_notes ?? body.usersNotes,
          viewersNotes: body.viewers_notes ?? body.viewersNotes,
          endDate: body.end_date ?? body.endDate,
          updatedBy: body.updated_by ?? body.updatedBy ?? viewer.memberId,
        };
        for (const key of Object.keys(patch)) {
          if (patch[key] === undefined) delete patch[key];
        }
        const archivedAtRaw = body.archived_at ?? body.archivedAt;
        const archivedByRaw = body.archived_by ?? body.archivedBy;
        // Optional (§6.9): only a caller that actually sends its last-known
        // updated_at back gets the conditional-write / 409 behavior.
        const expectedUpdatedAt = body.expected_updated_at ?? body.expectedUpdatedAt ?? undefined;
        let project;
        if (patch.status === "archived" && (archivedAtRaw || archivedByRaw)) {
          project = await archiveProjectPg(projectId, archivedByRaw ?? viewer.memberId, expectedUpdatedAt);
        } else {
          project = await updateProjectPg(projectId, patch, expectedUpdatedAt);
        }
        if (project && typeof project === "object" && "conflict" in project) {
          sendJson(res, origin, 409, {
            success: false,
            code: "stale_write",
            error: "Someone else changed this project while you were editing. Reload to see their changes.",
            data: project.current,
          });
          return true;
        }
        if (!project) {
          sendJson(res, origin, 404, { success: false, error: "Project not found" });
          return true;
        }
        sendJson(res, origin, 200, { success: true, data: project });
      } catch (e) {
        logSafeError("[projects/:id PATCH]", e);
        if (sendPgConstraintError(res, origin, e, req)) return true;
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to update project" });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        const viewer = await assertProjectDomainWrite(projectId, null);
        if (!viewer) return true;
        await deleteProjectPg(projectId, viewer.memberId);
        sendJson(res, origin, 200, { success: true, data: { id: projectId } });
      } catch (e) {
        logSafeError("[projects/:id DELETE]", e);
        sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to delete project" });
      }
      return true;
    }
  }

  // ─── /api/project-members ─────────────────────────────────────────────
  if (pn === "/api/project-members" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const rows = projectId ? await listProjectMembersPg(projectId) : await scopedRows(await pgQuery("SELECT * FROM project_members LIMIT 3000"));
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[project-members GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load project members" });
    }
    return true;
  }

  if (pn === "/api/project-members" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      validateProjectDomainBody("project-members", body, false);
      const projectId = String(body.project_id ?? body.projectId ?? "").trim();
      const memberId = String(body.member_id ?? body.memberId ?? "").trim();
      if (!projectId || !memberId) {
        sendJson(res, origin, 400, { success: false, error: "project_id and member_id are required" });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, memberId);
      if (!viewer) return true;
      const row = await addProjectMemberPg(projectId, memberId, {
        role: body.project_role ?? body.projectRole,
        actorId: body.assigned_by ?? body.assignedBy ?? viewer.memberId,
      });
      // Targeted frame (§4.2): gaining access to a project is the added
      // member's own scope changing, not something to broadcast.
      sendToMember(memberId, { type: "scope-changed", reason: "project-access", at: Date.now() });
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[project-members POST]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to add project member" });
    }
    return true;
  }

  const projectMemberIdMatch = /^\/api\/project-members\/([^/]+)$/.exec(pn);
  if (projectMemberIdMatch && req.method === "DELETE") {
    try {
      const rows = await pgQuery("SELECT project_id, member_id FROM project_members WHERE id = $1 LIMIT 1", [
        projectMemberIdMatch[1],
      ]);
      const existing = rows[0];
      if (!existing) {
        sendJson(res, origin, 200, { success: true, data: null });
        return true;
      }
      const viewer = await assertProjectDomainWrite(existing.project_id, existing.member_id);
      if (!viewer) return true;
      await removeProjectMemberPg(existing.project_id, existing.member_id, viewer.memberId);
      sendToMember(existing.member_id, { type: "scope-changed", reason: "project-access", at: Date.now() });
      sendJson(res, origin, 200, { success: true, data: { id: projectMemberIdMatch[1] } });
    } catch (e) {
      logSafeError("[project-members DELETE]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to remove project member" });
    }
    return true;
  }

  // ─── /api/project-budgets ──────────────────────────────────────────────
  if (pn === "/api/project-budgets" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const rows = projectId ? [await getProjectBudgetPg(projectId)].filter(Boolean) : await scopedRows(await getAllProjectBudgetsPg());
      // Real spent, not a stored/fabricated value - see computeProjectSpentPg.
      // Batched (computeProjectSpentForAllPg), not one query per row - this
      // endpoint returns every project's budget in one call on the projects
      // list page, so "per row" here used to mean "per project in the org".
      const spentByProject = await computeProjectSpentForAllPg(
        db,
        rows.map((row) => ({
          id: row.project_id,
          type: row.type,
          based_on: row.based_on,
          include_non_billable_time: row.include_non_billable_time,
        })),
      );
      // scope='per_person' rows store hours-per-member in `cost`, not a total -
      // this is the live total, same batching as spent above.
      const targetByProject = await computeProjectBudgetTargetForAllPg(
        db,
        rows.map((row) => ({
          id: row.project_id,
          type: row.type,
          based_on: row.based_on,
          scope: row.scope,
          cost: row.cost,
        })),
      );
      const data = rows.map((row) => ({
        ...row,
        spent: spentByProject.get(row.project_id) ?? 0,
        target: row.scope === "per_person" ? targetByProject.get(row.project_id) ?? 0 : Number(row.cost),
      }));
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[project-budgets GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load project budgets" });
    }
    return true;
  }

  if (pn === "/api/project-budgets" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      validateProjectDomainBody("project-budgets", body, false);
      const projectId = String(body.project_id ?? body.projectId ?? "").trim();
      if (!projectId) {
        sendJson(res, origin, 400, { success: false, error: "project_id is required" });
        return true;
      }
      // Every project requires a real budget (item 6 of the budget fixes plan) -
      // the client-side validator enforces this too, but the server is the real
      // gate, since `upsertProjectBudgetPg` otherwise defaults a missing cost to 0.
      if (!(Number(body.cost) > 0)) {
        sendJson(res, origin, 400, { success: false, error: "cost must be greater than 0" });
        return true;
      }
      // Calling projects have no tasks and no per-task bill/pay-rate anchor -
      // only Hours based is coherent (item 2 of the budget fixes plan). The
      // UI already forces this; this is the real gate.
      const project = await getProjectPg(projectId);
      if (project && String(project.type || "normal") === "calling" && String(body.type) !== "Hours based") {
        sendJson(res, origin, 400, {
          success: false,
          error: "Calling projects only support Hours based budgets.",
        });
        return true;
      }
      const scope = body.scope === "per_person" ? "per_person" : "per_project";
      const endDateError = await checkBudgetEndDateFeasible(db, project, scope, body.cost);
      if (endDateError) {
        sendJson(res, origin, 400, { success: false, error: endDateError });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, null);
      if (!viewer) return true;
      const row = await upsertProjectBudgetPg(
        projectId,
        {
          type: body.type,
          basedOn: body.based_on ?? body.basedOn,
          scope,
          cost: body.cost,
          notifyProjectMembers: body.notify_project_members ?? body.notifyProjectMembers,
          notifyAtPct: body.notify_at_pct ?? body.notifyAtPct,
          whoToNotify: body.who_to_notify ?? body.whoToNotify,
          stopTimersWhenReached: body.stop_timers_when_reached ?? body.stopTimersWhenReached,
          stopTimersAtPct: body.stop_timers_at_pct ?? body.stopTimersAtPct,
          resets: body.resets,
          startDate: body.start_date ?? body.startDate,
          includeNonBillableTime: body.include_non_billable_time ?? body.includeNonBillableTime,
        },
        body.created_by ?? body.createdBy ?? viewer.memberId,
      );
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[project-budgets POST]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to create project budget" });
    }
    return true;
  }

  const projectBudgetIdMatch = /^\/api\/project-budgets\/([^/]+)$/.exec(pn);
  if (projectBudgetIdMatch && (req.method === "PATCH" || req.method === "PUT")) {
    try {
      const rows = await pgQuery("SELECT project_id FROM project_budgets WHERE id = $1 LIMIT 1", [
        projectBudgetIdMatch[1],
      ]);
      const existing = rows[0];
      if (!existing) {
        sendJson(res, origin, 404, { success: false, error: "Project budget not found" });
        return true;
      }
      const viewer = await assertProjectDomainWrite(existing.project_id, null);
      if (!viewer) return true;
      const body = await readJsonBody(req);
      validateProjectDomainBody("project-budgets", body, true);
      const current = await getProjectBudgetPg(existing.project_id);
      const effectiveCost = Number(body.cost ?? current?.cost);
      if (!(effectiveCost > 0)) {
        sendJson(res, origin, 400, { success: false, error: "cost must be greater than 0" });
        return true;
      }
      const effectiveType = String(body.type ?? current?.type);
      const project = await getProjectPg(existing.project_id);
      if (project && String(project.type || "normal") === "calling" && effectiveType !== "Hours based") {
        sendJson(res, origin, 400, {
          success: false,
          error: "Calling projects only support Hours based budgets.",
        });
        return true;
      }
      const effectiveScope = body.scope === "per_person" ? "per_person" : body.scope ? "per_project" : current?.scope ?? "per_project";
      const endDateError = await checkBudgetEndDateFeasible(db, project, effectiveScope, effectiveCost);
      if (endDateError) {
        sendJson(res, origin, 400, { success: false, error: endDateError });
        return true;
      }
      // Optional (§6.9): only a caller that sends back its last-known updated_at
      // gets the conditional-write / 409 behavior.
      const expectedUpdatedAt = body.expected_updated_at ?? body.expectedUpdatedAt ?? undefined;
      const row = await upsertProjectBudgetPg(
        existing.project_id,
        {
          type: body.type ?? current?.type,
          basedOn: body.based_on ?? body.basedOn ?? current?.based_on,
          scope: effectiveScope,
          cost: body.cost ?? current?.cost,
          notifyProjectMembers: body.notify_project_members ?? body.notifyProjectMembers ?? current?.notify_project_members,
          notifyAtPct: body.notify_at_pct ?? body.notifyAtPct ?? current?.notify_at_pct,
          whoToNotify: body.who_to_notify ?? body.whoToNotify ?? current?.who_to_notify,
          stopTimersWhenReached:
            body.stop_timers_when_reached ?? body.stopTimersWhenReached ?? current?.stop_timers_when_reached,
          stopTimersAtPct: body.stop_timers_at_pct ?? body.stopTimersAtPct ?? current?.stop_timers_at_pct,
          resets: body.resets ?? current?.resets,
          // "start_date" in body (not ??) - an explicit null means "clear
          // it", which ?? can't distinguish from "key wasn't sent at all".
          startDate: "start_date" in body ? body.start_date : body.startDate ?? current?.start_date,
          includeNonBillableTime:
            body.include_non_billable_time ?? body.includeNonBillableTime ?? current?.include_non_billable_time,
        },
        body.updated_by ?? body.updatedBy ?? viewer.memberId,
        expectedUpdatedAt,
      );
      if (row && typeof row === "object" && "conflict" in row) {
        sendJson(res, origin, 409, {
          success: false,
          code: "stale_write",
          error: "Someone else changed this budget while you were editing. Reload to see their changes.",
          data: row.current,
        });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[project-budgets/:id PATCH]", e);
      if (sendPgConstraintError(res, origin, e, req)) return true;
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to update project budget" });
    }
    return true;
  }

  // ─── /api/project-member-limits ────────────────────────────────────────
  if (pn === "/api/project-member-limits" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const rows = projectId ? await listProjectMemberLimitsPg(projectId) : await scopedRows(await getAllProjectMemberLimitsPg());
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[project-member-limits GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load project member limits" });
    }
    return true;
  }

  if (pn === "/api/project-member-limits" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      validateProjectDomainBody("project-member-limits", body, false);
      const projectId = String(body.project_id ?? body.projectId ?? "").trim();
      const memberId = String(body.member_id ?? body.memberId ?? "").trim();
      if (!projectId) {
        sendJson(res, origin, 400, { success: false, error: "project_id is required" });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, memberId || null);
      if (!viewer) return true;
      const row = await upsertProjectMemberLimitPg(
        projectId,
        memberId,
        {
          type: body.type,
          basedOn: body.based_on ?? body.basedOn,
          cost: body.cost,
          resets: body.resets,
          startDate: body.start_date ?? body.startDate,
          notifyAtPct: body.notify_at_pct ?? body.notifyAtPct,
          notifyProjectMembers: body.notify_project_members ?? body.notifyProjectMembers,
        },
        body.created_by ?? body.createdBy ?? viewer.memberId,
      );
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[project-member-limits POST]", e);
      sendJson(res, origin, 400, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to create project member limit",
      });
    }
    return true;
  }

  // ─── /api/client-projects ──────────────────────────────────────────────
  if (pn === "/api/client-projects" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const clientId = url.searchParams.get("client_id");
      let rows;
      if (projectId) {
        rows = (await listClientIdsForProjectPg(projectId)).map((cid) => ({ client_id: cid, project_id: projectId }));
      } else if (clientId) {
        rows = (await listProjectIdsForClientPg(clientId)).map((pid) => ({ client_id: clientId, project_id: pid }));
      } else {
        rows = await pgQuery("SELECT * FROM client_projects LIMIT 2000");
      }
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[client-projects GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load client-project links" });
    }
    return true;
  }

  if (pn === "/api/client-projects" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      validateProjectDomainBody("client-projects", body, false);
      const projectId = String(body.project_id ?? body.projectId ?? "").trim();
      const clientId = String(body.client_id ?? body.clientId ?? "").trim();
      if (!projectId || !clientId) {
        sendJson(res, origin, 400, { success: false, error: "project_id and client_id are required" });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, null);
      if (!viewer) return true;
      const row = await linkClientProjectPg(clientId, projectId, body.assigned_by ?? body.assignedBy ?? viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[client-projects POST]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to link client to project" });
    }
    return true;
  }

  const clientProjectIdMatch = /^\/api\/client-projects\/([^/]+)$/.exec(pn);
  if (clientProjectIdMatch && req.method === "DELETE") {
    try {
      const rows = await pgQuery("SELECT project_id, client_id FROM client_projects WHERE id = $1 LIMIT 1", [
        clientProjectIdMatch[1],
      ]);
      const existing = rows[0];
      if (!existing) {
        sendJson(res, origin, 200, { success: true, data: null });
        return true;
      }
      const viewer = await assertProjectDomainWrite(existing.project_id, null);
      if (!viewer) return true;
      await unlinkClientProjectPg(existing.client_id, existing.project_id);
      sendJson(res, origin, 200, { success: true, data: { id: clientProjectIdMatch[1] } });
    } catch (e) {
      logSafeError("[client-projects DELETE]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to remove client-project link" });
    }
    return true;
  }

  // ─── /api/team-projects ────────────────────────────────────────────────
  if (pn === "/api/team-projects" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const teamId = url.searchParams.get("team_id");
      let rows;
      if (projectId) {
        rows = (await listTeamIdsForProjectPg(projectId)).map((tid) => ({ team_id: tid, project_id: projectId }));
      } else if (teamId) {
        rows = (await listProjectIdsForTeamPg(teamId)).map((pid) => ({ team_id: teamId, project_id: pid }));
      } else {
        rows = await pgQuery("SELECT * FROM team_projects LIMIT 2000");
      }
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[team-projects GET]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load team-project links" });
    }
    return true;
  }

  if (pn === "/api/team-projects" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      validateProjectDomainBody("team-projects", body, false);
      const projectId = String(body.project_id ?? body.projectId ?? "").trim();
      const teamId = String(body.team_id ?? body.teamId ?? "").trim();
      if (!projectId || !teamId) {
        sendJson(res, origin, 400, { success: false, error: "project_id and team_id are required" });
        return true;
      }
      const authViewer = getAuthContext(req);
      const viewer = authViewer && requireManagementRole(authViewer) ? authViewer : await assertTeamProjectWrite(teamId);
      if (!viewer) return true;
      const row = await linkTeamProjectPg(teamId, projectId, body.assigned_by ?? body.assignedBy ?? viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[team-projects POST]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to link team to project" });
    }
    return true;
  }

  const teamProjectIdMatch = /^\/api\/team-projects\/([^/]+)$/.exec(pn);
  if (teamProjectIdMatch && req.method === "DELETE") {
    try {
      const rows = await pgQuery("SELECT project_id, team_id FROM team_projects WHERE id = $1 LIMIT 1", [
        teamProjectIdMatch[1],
      ]);
      const existing = rows[0];
      if (!existing) {
        sendJson(res, origin, 200, { success: true, data: null });
        return true;
      }
      const authViewer = getAuthContext(req);
      const viewer =
        authViewer && requireManagementRole(authViewer) ? authViewer : await assertTeamProjectWrite(existing.team_id);
      if (!viewer) return true;
      await unlinkTeamProjectPg(existing.team_id, existing.project_id);
      sendJson(res, origin, 200, { success: true, data: { id: teamProjectIdMatch[1] } });
    } catch (e) {
      logSafeError("[team-projects DELETE]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to remove team-project link" });
    }
    return true;
  }

  return false;
}
