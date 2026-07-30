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
import { schemaByKey } from "../schema/catalog/index.js";
import { buildCreatePayload, buildUpdatePayload } from "../schema/services/schema-crud.service.js";

/** Field-type coercion + unknown-field rejection, reusing the same catalog
 * validation the old generic Firestore path used (schema/catalog/projects) -
 * not reinvented, just applied as a gate before the values that were already
 * being read manually below. Throws (message becomes the 400 response) on a
 * bad field name or wrong type. */
function validateProjectDomainBody(entityKey, body, isUpdate) {
  const entity = schemaByKey.get(entityKey);
  if (!entity) return;
  if (isUpdate) buildUpdatePayload(entity, body);
  else buildCreatePayload(entity, body);
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
        const refs = teamIds.map((id) => db.collection("teams").doc(id));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
          if (!snap.exists) continue;
          const row = snap.data() || {};
          teamNameById.set(
            snap.id,
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
        const refs = teamIds.map((id) => db.collection("teams").doc(id));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
          if (!snap.exists) continue;
          const row = snap.data() || {};
          teams.push({
            id: snap.id,
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
          clientIds,
          teamIds,
          managerIds,
          userIds,
          viewerIds,
          memberLimitMemberIds:
            limit && (limit.member_id || limit.memberId)
              ? [String(limit.member_id || limit.memberId)]
              : [],
          hasBudget: budget
            ? Boolean(budget.stop_timers_when_reached ?? budget.stopTimersWhenReached ?? true)
            : true,
          budgetId: budget ? String(budget.id) : undefined,
          budgetType: budget ? String(budget.type || "") : "",
          budgetBasedOn: budget ? String(budget.based_on || budget.basedOn || "") : "",
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
          budgetStartDate: budget ? toIso(budget.start_date || budget.startDate) : "",
          budgetIncludeNonBillable: budget
            ? Boolean(budget.include_non_billable_time ?? budget.includeNonBillableTime ?? true)
            : true,
          budgetNotifyMembers: budget
            ? Boolean(budget.notify_project_members ?? budget.notifyProjectMembers)
            : false,
          memberLimitType: limit ? String(limit.type || "") : "",
          memberLimitBasedOn: limit ? String(limit.based_on || limit.basedOn || "") : "",
          memberLimitResets: limit ? String(limit.resets || "Never") : "Never",
          memberLimitStartDate: limit ? toIso(limit.start_date || limit.startDate) : "",
          memberLimitNotifyAt:
            limit && limit.notify_at_pct != null
              ? String(limit.notify_at_pct)
              : limit && limit.notifyAtPct != null
                ? String(limit.notifyAtPct)
                : "80",
          memberLimitNotifyMembers: limit
            ? Boolean(limit.notify_project_members ?? limit.notifyProjectMembers ?? true)
            : true,
          memberLimitMembers: limit ? String(limit.member_id || limit.memberId || "") : "",
          budgetSpent: 0,
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
      const [clientRows, membersSnap] = await Promise.all([
        listClientsEnriched(db),
        db.collection("members").limit(500).get(),
      ]);

      const clients = clientRows
        .filter((c) => c.status !== "archived")
        .map((c) => ({
          id: c.id,
          label: typeof c.name === "string" && c.name.trim() ? c.name.trim() : "Unnamed client",
          budget: c.budget ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const rawMembers = membersSnap.docs
        .map((doc) => {
          const d = doc.data() || {};
          const status = typeof d.status === "string" ? d.status.toLowerCase() : "active";
          if (status === "archived" || status === "inactive") return null;
          return { id: doc.id, ...d };
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
        clientId: body.client_id ?? body.clientId,
        managersNotes: body.managers_notes ?? body.managersNotes,
        usersNotes: body.users_notes ?? body.usersNotes,
        viewersNotes: body.viewers_notes ?? body.viewersNotes,
        type: normalizeProjectType(body.type),
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
        const patch = {
          name: body.name,
          status: body.status,
          billable: body.billable,
          disableActivity: body.disable_activity ?? body.disableActivity,
          allowProjectTracking: body.allow_project_tracking ?? body.allowProjectTracking,
          disableIdleTime: body.disable_idle_time ?? body.disableIdleTime,
          clientId: body.client_id ?? body.clientId,
          managersNotes: body.managers_notes ?? body.managersNotes,
          usersNotes: body.users_notes ?? body.usersNotes,
          viewersNotes: body.viewers_notes ?? body.viewersNotes,
          updatedBy: body.updated_by ?? body.updatedBy ?? viewer.memberId,
        };
        for (const key of Object.keys(patch)) {
          if (patch[key] === undefined) delete patch[key];
        }
        const archivedAtRaw = body.archived_at ?? body.archivedAt;
        const archivedByRaw = body.archived_by ?? body.archivedBy;
        let project;
        if (patch.status === "archived" && (archivedAtRaw || archivedByRaw)) {
          project = await archiveProjectPg(projectId, archivedByRaw ?? viewer.memberId);
        } else {
          project = await updateProjectPg(projectId, patch);
        }
        if (!project) {
          sendJson(res, origin, 404, { success: false, error: "Project not found" });
          return true;
        }
        sendJson(res, origin, 200, { success: true, data: project });
      } catch (e) {
        logSafeError("[projects/:id PATCH]", e);
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to update project" });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        const viewer = await assertProjectDomainWrite(projectId, null);
        if (!viewer) return true;
        await deleteProjectPg(projectId);
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
      await removeProjectMemberPg(existing.project_id, existing.member_id);
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
      // Always computed (test-data scale, cost of a per-row query is fine here).
      const data = await Promise.all(
        rows.map(async (row) => ({ ...row, spent: await computeProjectSpentPg(db, row.project_id, row) })),
      );
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
      const viewer = await assertProjectDomainWrite(projectId, null);
      if (!viewer) return true;
      const row = await upsertProjectBudgetPg(
        projectId,
        {
          type: body.type,
          basedOn: body.based_on ?? body.basedOn,
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
      const row = await upsertProjectBudgetPg(
        existing.project_id,
        {
          type: body.type ?? current?.type,
          basedOn: body.based_on ?? body.basedOn ?? current?.based_on,
          cost: body.cost ?? current?.cost,
          notifyProjectMembers: body.notify_project_members ?? body.notifyProjectMembers ?? current?.notify_project_members,
          notifyAtPct: body.notify_at_pct ?? body.notifyAtPct ?? current?.notify_at_pct,
          whoToNotify: body.who_to_notify ?? body.whoToNotify ?? current?.who_to_notify,
          stopTimersWhenReached:
            body.stop_timers_when_reached ?? body.stopTimersWhenReached ?? current?.stop_timers_when_reached,
          stopTimersAtPct: body.stop_timers_at_pct ?? body.stopTimersAtPct ?? current?.stop_timers_at_pct,
          resets: body.resets ?? current?.resets,
          startDate: body.start_date ?? body.startDate ?? current?.start_date,
          includeNonBillableTime:
            body.include_non_billable_time ?? body.includeNonBillableTime ?? current?.include_non_billable_time,
        },
        body.updated_by ?? body.updatedBy ?? viewer.memberId,
      );
      sendJson(res, origin, 200, { success: true, data: row });
    } catch (e) {
      logSafeError("[project-budgets/:id PATCH]", e);
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
