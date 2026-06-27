import { COLLECTIONS } from "../../lib/firestore/collections.js";
import { assertManagementRole } from "../../http/authorization.js";
import { getAuthContext } from "../../http/auth-context.js";
import { assertProjectAccessible, getViewerProjectIds, toAllowedProjectSet } from "../../http/project-access.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { listClientsEnriched } from "../clients/services/client-service.js";
import { getOverviewCore, getOverviewPanels } from "./services/overview-service.js";
import { PROJECT_FORM_FIELDS, PROJECT_FORM_TABS } from "./form-config.js";
import { memberDisplayLabel } from "../members/services/member-display-name.js";

function memberLabel(data) {
  return memberDisplayLabel(data);
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
      const linksSnap = await db.collection("team_projects").select("team_id", "teamId", "project_id", "projectId").get();
      const teamIds = [
        ...new Set(
          linksSnap.docs
            .map((doc) => {
              const row = doc.data() || {};
              return String(row.team_id || row.teamId || "").trim();
            })
            .filter(Boolean),
        ),
      ];

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

      const data = linksSnap.docs.flatMap((doc) => {
        const row = doc.data() || {};
        const projectId = String(row.project_id || row.projectId || "").trim();
        if (allowed !== null && projectId && !allowed.has(projectId)) return [];
        const teamId = String(row.team_id || row.teamId || "").trim();
        return [{
          id: doc.id,
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
      const projectDoc = await db.collection(COLLECTIONS.projects).doc(projectId).get();
      if (!projectDoc.exists) {
        sendJson(res, origin, 404, { success: false, error: "Project not found" });
        return true;
      }

      const linksSnap = await db.collection("team_projects").where("project_id", "==", projectId).get();
      const teamIds = [
        ...new Set(
          linksSnap.docs
            .map((doc) => {
              const row = doc.data() || {};
              return String(row.team_id || row.teamId || "").trim();
            })
            .filter(Boolean),
        ),
      ];

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
      const projectRef = db.collection(COLLECTIONS.projects).doc(projectId);
      const [projectDoc, membersSnap, teamLinksSnap, clientLinksSnap, budgetsSnap, limitsSnap] = await Promise.all([
        projectRef.get(),
        db.collection("project_members").where("project_id", "==", projectId).get(),
        db.collection("team_projects").where("project_id", "==", projectId).get(),
        db.collection("client_projects").where("project_id", "==", projectId).get(),
        db.collection("project_budgets").where("project_id", "==", projectId).get(),
        db.collection("project_member_limits").where("project_id", "==", projectId).get(),
      ]);

      if (!projectDoc.exists) {
        sendJson(res, origin, 404, { success: false, error: "Project not found" });
        return true;
      }

      const project = projectDoc.data() || {};
      const managerIds = [];
      const userIds = [];
      const viewerIds = [];

      const pushUnique = (list, id) => {
        if (id && !list.includes(id)) list.push(id);
      };
      for (const doc of membersSnap.docs) {
        const row = doc.data() || {};
        const memberId = String(row.member_id || row.memberId || "").trim();
        if (!memberId) continue;
        const role = normalizeProjectRole(row.project_role || row.projectRole);
        if (role === "member") continue;
        if (role === "manager") pushUnique(managerIds, memberId);
        else if (role === "user") pushUnique(userIds, memberId);
        else if (role === "viewer") pushUnique(viewerIds, memberId);
      }

      const teamIds = teamLinksSnap.docs
        .map((doc) => {
          const row = doc.data() || {};
          return String(row.team_id || row.teamId || "").trim();
        })
        .filter(Boolean);

      const budgetDoc = budgetsSnap.docs[0];
      const budget = budgetDoc ? { id: budgetDoc.id, ...budgetDoc.data() } : null;
      const limitDoc = limitsSnap.docs[0];
      const limit = limitDoc ? { id: limitDoc.id, ...limitDoc.data() } : null;

      const clientIdsFromLinks = clientLinksSnap.docs
        .map((doc) => {
          const row = doc.data() || {};
          return String(row.client_id || row.clientId || "").trim();
        })
        .filter(Boolean);

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

      const rolesSnap = await db.collection("roles").limit(100).get();
      const roleNameById = new Map(
        rolesSnap.docs.map((doc) => {
          const row = doc.data() || {};
          return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
        }),
      );

      const members = membersSnap.docs
        .map((doc) => {
          const d = doc.data() || {};
          const { name, initials } = memberLabel(d);
          const status = typeof d.status === "string" ? d.status.toLowerCase() : "active";
          if (status === "archived" || status === "inactive") return null;
          const role = roleNameById.get(typeof d.role_id === "string" ? d.role_id : "") || "User";
          return { id: doc.id, label: name, initials, role };
        })
        .filter(Boolean)
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

  return false;
}
