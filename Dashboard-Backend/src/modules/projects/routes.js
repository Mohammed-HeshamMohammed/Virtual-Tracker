import { assertManagementRole, canAccessMember } from "../../http/authorization.js";
import { getAuthContext, isManagementRole, requireManagementRole } from "../../http/auth-context.js";
import { isAdminLevelRole } from "../../http/role-hierarchy.js";
import { resolveMemberRoleNameCached } from "../../http/role-cache.js";
import {
  assertProjectAccessible,
  clientMayTrackProject,
  getViewerProjectIds,
  isOrgProjectAdminRole,
  listTrackableProjectIdsPg,
  toAllowedProjectSet,
  viewerCanCreateProjectTasks,
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
  deleteProjectMemberLimitPg,
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
import { getMemberLimitHours } from "../tasks/task-workload-validation.js";
import { PROJECT_TYPES, projectTypeDef, projectTypeForcesHours } from "./project-types.js";
import { listSubProjectIdsPg, setSubProjectsPg } from "./management-rollup.service.js";

function validateProjectDomainBody(entityKey, body, isUpdate) {
  const entity = schemaByKey.get(entityKey);
  if (!entity) return;
  const SUB_PROJECT_FIELDS = ["sub_project_ids", "subProjectIds"];
  const options = isUpdate
    ? { extraAllowedFields: ["expected_updated_at", "expectedUpdatedAt", ...SUB_PROJECT_FIELDS] }
    : { extraAllowedFields: SUB_PROJECT_FIELDS };
  if (isUpdate) buildUpdatePayload(entity, body, options);
  else buildCreatePayload(entity, body, options);
}

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

export { PROJECT_TYPES };

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
      const includeClientBudgets = Boolean(viewer && isOrgProjectAdminRole(viewer.roleName));
      const data = await getOverviewPanels(db, { taskLimit, allowedProjectIds: allowed, includeClientBudgets });
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

      const memberLimits = limitRows
        .map((row) => ({
          memberId: String(row.member_id || row.memberId || ""),
          type: String(row.type || ""),
          basedOn: String(row.based_on || row.basedOn || ""),
          cost: String(row.cost ?? ""),
          resets: String(row.resets || "Never"),
          startDate: toIso(row.start_date || row.startDate).slice(0, 10),
        }))
        .filter((row) => row.memberId);

      const limitMemberIds = [...new Set([...managerIds, ...userIds, ...viewerIds])];
      const ownLimitEntries = await Promise.all(
        limitMemberIds.map(async (memberId) => [
          memberId,
          {
            daily: await getMemberLimitHours(db, memberId, "daily"),
            weekly: await getMemberLimitHours(db, memberId, "weekly"),
          },
        ]),
      );
      const memberOwnLimits = Object.fromEntries(ownLimitEntries);

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
          requireTaskToTrack: Boolean(project.require_task_to_track ?? project.requireTaskToTrack ?? true),
          restrictTaskCreation: Boolean(project.restrict_task_creation ?? project.restrictTaskCreation ?? true),
          requireStopNote: Boolean(project.require_stop_note ?? project.requireStopNote ?? false),
          clientCanManage: Boolean(project.client_can_manage ?? project.clientCanManage ?? false),
          clientCanTrack: Boolean(project.client_can_track ?? project.clientCanTrack ?? false),
          endDate: toIso(project.end_date || project.endDate).slice(0, 10),
          subProjectIds: projectTypeDef(project.type).hasSubProjects
            ? await listSubProjectIdsPg(projectId)
            : [],
          clientIds,
          teamIds,
          managerIds,
          userIds,
          viewerIds,
          memberLimitMemberIds: memberLimits.map((row) => row.memberId),
          memberLimits,
          memberOwnLimits,
          budgetStopTimers: budget
            ? Boolean(budget.stop_timers_when_reached ?? budget.stopTimersWhenReached ?? true)
            : true,
          budgetId: budget ? String(budget.id) : undefined,
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

  // GET /api/projects/trackable?memberId=X - projects the target member can
  // actually clock in on (see listTrackableProjectIdsPg), for the Project
  // dropdown when adding manual time for someone else - that needs the
  // *target's* trackability, not the viewer's own project visibility (a
  // manager can see a project without being a trackable member of it).
  // memberId omitted = the viewer's own trackable projects.
  if (pn === "/api/projects/trackable" && req.method === "GET") {
    try {
      const viewer = getAuthContext(req);
      if (!viewer) {
        sendJson(res, origin, 401, { success: false, error: "Authorization required." });
        return true;
      }
      const targetMemberId = (url.searchParams.get("memberId") || "").trim() || viewer.memberId;
      if (targetMemberId !== viewer.memberId) {
        if (!isManagementRole(viewer.roleName)) {
          sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
          return true;
        }
        const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, targetMemberId);
        if (!allowed) {
          sendJson(res, origin, 403, { success: false, error: "Cannot view this member's projects." });
          return true;
        }
      }
      const targetRoleName = await resolveMemberRoleNameCached(db, targetMemberId);
      const trackableIds = await listTrackableProjectIdsPg(targetMemberId, targetRoleName);
      let rows = await listProjectsPg({ limit: 500 });
      rows = rows.filter((p) => String(p.status ?? "").toLowerCase() !== "archived");
      if (trackableIds !== null) {
        const idSet = new Set(trackableIds);
        rows = rows.filter((p) => idSet.has(String(p.id)));
      }
      sendJson(res, origin, 200, { success: true, data: rows.map((p) => ({ id: p.id, name: p.name })) });
    } catch (e) {
      logSafeError("[projects/trackable]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load trackable projects",
      });
    }
    return true;
  }

  if (pn === "/api/projects" && req.method === "GET") {
    try {
      const projectIdFilter = url.searchParams.get("project_id");
      let rows = projectIdFilter ? [await getProjectPg(projectIdFilter)].filter(Boolean) : await listProjectsPg({ limit: 500 });
      rows = await scopedRows(rows, "id");
      const viewer = getAuthContext(req);
      const withDerived = await Promise.all(
        rows.map(async (row) => {
          const clientTrackable = viewer ? await clientMayTrackProject(viewer, row.id) : false;
          const orgAdminTrackable = viewer ? isAdminLevelRole(viewer.roleName) : false;
          return {
            ...row,
            has_tasks: projectTypeDef(row.type).hasTasks,
            can_create_tasks: viewer ? await viewerCanCreateProjectTasks(db, viewer, row.id) : false,
            ...(clientTrackable || orgAdminTrackable ? { require_task_to_track: false } : {}),
          };
        }),
      );
      sendJson(res, origin, 200, { success: true, data: withDerived });
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
        requireTaskToTrack: body.require_task_to_track ?? body.requireTaskToTrack,
        restrictTaskCreation: body.restrict_task_creation ?? body.restrictTaskCreation,
        requireStopNote: body.require_stop_note ?? body.requireStopNote,
        clientCanManage: (body.client_can_manage ?? body.clientCanManage) === true,
        clientCanTrack: (body.client_can_track ?? body.clientCanTrack) === true,
        createdBy: body.created_by ?? body.createdBy ?? viewer.memberId,
      });
      const subProjectIds = body.sub_project_ids ?? body.subProjectIds;
      if (project && Array.isArray(subProjectIds) && projectTypeDef(project.type).hasSubProjects) {
        await setSubProjectsPg(project.id, subProjectIds, viewer.memberId);
      }
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
          requireTaskToTrack: body.require_task_to_track ?? body.requireTaskToTrack,
          restrictTaskCreation: body.restrict_task_creation ?? body.restrictTaskCreation,
          requireStopNote: body.require_stop_note ?? body.requireStopNote,
          clientCanManage: body.client_can_manage ?? body.clientCanManage,
          clientCanTrack: body.client_can_track ?? body.clientCanTrack,
          updatedBy: body.updated_by ?? body.updatedBy ?? viewer.memberId,
        };
        for (const key of Object.keys(patch)) {
          if (patch[key] === undefined) delete patch[key];
        }
        const archivedAtRaw = body.archived_at ?? body.archivedAt;
        const archivedByRaw = body.archived_by ?? body.archivedBy;
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
        const nextSubProjectIds = body.sub_project_ids ?? body.subProjectIds;
        if (Array.isArray(nextSubProjectIds) && projectTypeDef(project.type).hasSubProjects) {
          await setSubProjectsPg(projectId, nextSubProjectIds, viewer.memberId);
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
      const targetProject = await getProjectPg(projectId);
      const roleFilter = projectTypeDef(targetProject?.type).membersRoleFilter;
      if (roleFilter === "manager_and_above") {
        const memberRole = await resolveMemberRoleNameCached(db, memberId);
        if (!isManagementRole(memberRole)) {
          sendJson(res, origin, 400, {
            success: false,
            error: `${projectTypeDef(targetProject?.type).label} projects can only include managers and above.`,
          });
          return true;
        }
      }
      const row = await addProjectMemberPg(projectId, memberId, {
        role: body.project_role ?? body.projectRole,
        actorId: body.assigned_by ?? body.assignedBy ?? viewer.memberId,
      });
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

  if (pn === "/api/project-budgets" && req.method === "GET") {
    try {
      const projectId = url.searchParams.get("project_id");
      const rows = projectId ? [await getProjectBudgetPg(projectId)].filter(Boolean) : await scopedRows(await getAllProjectBudgetsPg());
      const spentByProject = await computeProjectSpentForAllPg(
        db,
        rows.map((row) => ({
          id: row.project_id,
          type: row.type,
          based_on: row.based_on,
          include_non_billable_time: row.include_non_billable_time,
          start_date: row.start_date,
          end_date: row.end_date,
        })),
      );
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
      if (!(Number(body.cost) > 0)) {
        sendJson(res, origin, 400, { success: false, error: "cost must be greater than 0" });
        return true;
      }
      const project = await getProjectPg(projectId);
      if (project && projectTypeForcesHours(project.type) && String(body.type) !== "Hours based") {
        sendJson(res, origin, 400, {
          success: false,
          error: `${projectTypeDef(project.type).label} projects only support Hours based budgets.`,
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
      if (project && projectTypeForcesHours(project.type) && effectiveType !== "Hours based") {
        sendJson(res, origin, 400, {
          success: false,
          error: `${projectTypeDef(project.type).label} projects only support Hours based budgets.`,
        });
        return true;
      }
      const effectiveScope = body.scope === "per_person" ? "per_person" : body.scope ? "per_project" : current?.scope ?? "per_project";
      const endDateError = await checkBudgetEndDateFeasible(db, project, effectiveScope, effectiveCost);
      if (endDateError) {
        sendJson(res, origin, 400, { success: false, error: endDateError });
        return true;
      }
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

  const projectAnchorMatch = /^\/api\/projects\/([^/]+)\/budget-anchor$/.exec(pn);
  if (projectAnchorMatch && req.method === "PATCH") {
    try {
      const projectId = projectAnchorMatch[1];
      const current = await getProjectBudgetPg(projectId);
      if (!current) {
        sendJson(res, origin, 404, { success: false, error: "Set up a budget for this project before anchoring its reset period." });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, null);
      if (!viewer) return true;
      const body = await readJsonBody(req);
      const startDate = String(body.start_date ?? body.startDate ?? "").trim();
      if (!startDate) {
        sendJson(res, origin, 400, { success: false, error: "Pick a start date for the next reset period." });
        return true;
      }
      const endDate = String(body.end_date ?? body.endDate ?? "").trim() || null;
      if (endDate && endDate < startDate) {
        sendJson(res, origin, 400, { success: false, error: "End date can't be before the start date." });
        return true;
      }
      const row = await upsertProjectBudgetPg(
        projectId,
        {
          type: current.type,
          basedOn: current.based_on,
          scope: current.scope,
          cost: current.cost,
          notifyProjectMembers: current.notify_project_members,
          notifyAtPct: current.notify_at_pct,
          whoToNotify: current.who_to_notify,
          stopTimersWhenReached: current.stop_timers_when_reached,
          stopTimersAtPct: current.stop_timers_at_pct,
          resets: current.resets,
          includeNonBillableTime: current.include_non_billable_time,
          startDate,
          endDate,
        },
        viewer.memberId,
      );
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[projects/:id/budget-anchor PATCH]", e);
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to anchor the reset period" });
    }
    return true;
  }

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

  if (pn === "/api/project-member-limits" && req.method === "DELETE") {
    try {
      const projectId = String(url.searchParams.get("project_id") || "").trim();
      const memberId = String(url.searchParams.get("member_id") || "").trim();
      if (!projectId || !memberId) {
        sendJson(res, origin, 400, { success: false, error: "project_id and member_id are required" });
        return true;
      }
      const viewer = await assertProjectDomainWrite(projectId, memberId);
      if (!viewer) return true;
      const removed = await deleteProjectMemberLimitPg(projectId, memberId);
      sendJson(res, origin, 200, { success: true, data: { removed } });
    } catch (e) {
      logSafeError("[project-member-limits DELETE]", e);
      sendJson(res, origin, 400, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to remove project member limit",
      });
    }
    return true;
  }

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
