import { getAuthContext } from "../../http/auth-context.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { applyInviteFieldPolicy, applyMemberFieldPolicy } from "../../http/field-policy.js";
import { getViewerProjectIds } from "../../http/project-access.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { getTeamIdsLedByMember, canManageAllTeams } from "../../http/team-edit-access.js";
import { query as pgQuery } from "../../lib/postgres/client.js";

const visibilityCache = new Map();
const CACHE_TTL_MS = 5000;

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 */
async function getCachedVisibleMemberIds(db, memberId, roleName) {
  const cached = visibilityCache.get(memberId);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await getVisibleMemberIds(db, memberId, roleName);
  visibilityCache.set(memberId, { data, timestamp: now });
  return data;
}

/** Filter schema rows by viewer visibility (no auth → empty). */
export async function applyVisibilityFilter(req, db, collectionKey, rows) {
  if (!rows || rows.length === 0) return rows;

  const filterableCollections = [
    "members",
    "projects",
    "project-members",
    "project-budgets",
    "project-member-limits",
    "client-projects",
    "tasks",
    "clients",
    "invites",
    "notifications",
    "pay-rates",
    "teams",
    "team-members",
    "team-projects",
    "timesheets",
    "time-entries",
  ];
  if (!filterableCollections.includes(collectionKey)) return rows;

  const viewer = getAuthContext(req);
  if (!viewer) return [];

  try {
    const mId = viewer.memberId;
    const mRole = viewer.roleName;

    if (collectionKey === "notifications") {
      return rows.filter((r) => r.recipient_id === mId);
    }

    const visibleIds = await getCachedVisibleMemberIds(db, mId, mRole);
    const visibleSet = visibleIds === null ? null : new Set(visibleIds);

    let filtered = rows;

    if (collectionKey === "members") {
      filtered = visibleSet === null ? rows : rows.filter((r) => visibleSet.has(r.id));
      return applyMemberFieldPolicy(filtered, viewer);
    }

    if (collectionKey === "invites") {
      filtered =
        visibleSet === null
          ? rows
          : rows.filter((r) => visibleSet.has(r.created_by) || r.created_by === "");
      return applyInviteFieldPolicy(filtered, viewer);
    }

    if (collectionKey === "pay-rates") {
      filtered =
        visibleSet === null
          ? rows
          : rows.filter((r) => {
              const memberId = typeof r.member_id === "string" ? r.member_id : "";
              return visibleSet.has(memberId);
            });
      return applyMemberFieldPolicy(filtered, viewer);
    }

    if (
      canManageAllTeams(mRole) &&
      (collectionKey === "teams" || collectionKey === "team-members" || collectionKey === "team-projects")
    ) {
      return filtered;
    }

    if (collectionKey === "projects") {
      const allowedProjects = await getViewerProjectIds(db, mId, mRole);
      if (allowedProjects === null) return filtered;
      const projectSet = new Set(allowedProjects);
      return filtered.filter((r) => {
        const id = typeof r.id === "string" ? r.id : "";
        if (id && projectSet.has(id)) return true;
        const createdBy = String(r.created_by ?? r.createdBy ?? "").trim();
        return createdBy === mId;
      });
    }

    const projectScopedKeys = new Set([
      "project-members",
      "project-budgets",
      "project-member-limits",
      "client-projects",
    ]);
    if (projectScopedKeys.has(collectionKey)) {
      const allowedProjects = await getViewerProjectIds(db, mId, mRole);
      if (allowedProjects === null) return filtered;
      const projectSet = new Set(allowedProjects);
      return filtered.filter((r) => {
        const projectId = typeof r.project_id === "string" ? r.project_id : "";
        return projectId && projectSet.has(projectId);
      });
    }

    if (collectionKey === "tasks") {
      const allowedProjects = await getViewerProjectIds(db, mId, mRole);
      if (allowedProjects === null) return filtered;
      const projectSet = new Set(allowedProjects);
      return filtered.filter((r) => {
        const projectId = String(r.project_id ?? r.projectId ?? "").trim();
        if (projectId && projectSet.has(projectId)) return true;
        const assignedTo = String(r.assigned_to ?? r.assignedTo ?? r.assignee_id ?? r.assigneeId ?? "").trim();
        if (assignedTo === mId) return true;
        const createdBy = String(r.created_by ?? r.createdBy ?? "").trim();
        if (createdBy === mId) return true;
        if (visibleSet && assignedTo && visibleSet.has(assignedTo)) return true;
        if (visibleSet && createdBy && visibleSet.has(createdBy)) return true;
        return false;
      });
    }

    if (visibleSet === null) return filtered;

    if (collectionKey === "clients") {
      return filtered.filter((r) => {
        const memberId =
          (typeof r.client_member === "string" && r.client_member) ||
          (typeof r.clientMember === "string" && r.clientMember) ||
          (typeof r.member_id === "string" && r.member_id) ||
          "";
        return memberId && visibleSet.has(memberId);
      });
    }

    if (collectionKey === "time-entries" || collectionKey === "timesheets") {
      return filtered.filter((r) => {
        const memberId = typeof r.member_id === "string" ? r.member_id : "";
        return memberId === mId || visibleSet.has(memberId);
      });
    }

    if (collectionKey === "team-members") {
      const ledTeamIds = await getTeamIdsLedByMember(db, mId);
      return filtered.filter((r) => {
        const memberId = typeof r.member_id === "string" ? r.member_id : "";
        const teamId = typeof r.team_id === "string" ? r.team_id : "";
        if (teamId && ledTeamIds.has(teamId)) return true;
        return memberId === mId || visibleSet.has(memberId);
      });
    }

    if (collectionKey === "team-projects") {
      const ledTeamIds = await getTeamIdsLedByMember(db, mId);
      const allowedProjects = await getViewerProjectIds(db, mId, mRole);
      if (allowedProjects === null) return filtered;
      const projectSet = new Set(allowedProjects);
      return filtered.filter((r) => {
        const projectId = typeof r.project_id === "string" ? r.project_id : "";
        const teamId = typeof r.team_id === "string" ? r.team_id : "";
        if (teamId && ledTeamIds.has(teamId)) return true;
        return projectId && projectSet.has(projectId);
      });
    }

    if (collectionKey === "teams") {
      const visibleWithSelf = new Set([...visibleSet, mId]);
      const ledTeamIds = await getTeamIdsLedByMember(db, mId);
      const teamIds = filtered.map((r) => (typeof r.id === "string" ? r.id : "")).filter(Boolean);
      if (!teamIds.length) return filtered;
      const visibleTeamIds = new Set(ledTeamIds);
      for (const row of filtered) {
        const createdBy = typeof row.created_by === "string" ? row.created_by : "";
        if (createdBy === mId) {
          visibleTeamIds.add(row.id);
        }
      }
      if (teamIds.length > 0) {
        const rows = await pgQuery(
          "SELECT team_id, member_id FROM team_members WHERE team_id = ANY($1)",
          [teamIds],
        );
        for (const data of rows) {
          const teamId = typeof data.team_id === "string" ? data.team_id : "";
          const memberId = typeof data.member_id === "string" ? data.member_id : "";
          if (teamId && (memberId === mId || visibleWithSelf.has(memberId))) {
            visibleTeamIds.add(teamId);
          }
        }
      }
      return filtered.filter((r) => visibleTeamIds.has(r.id));
    }

    return filtered;
  } catch (err) {
    logSafeError("[applyVisibilityFilter]", err);
    return [];
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collectionKey
 * @param {Record<string, unknown>} row
 */
export async function assertRowVisible(req, db, collectionKey, row) {
  const [visible] = await applyVisibilityFilter(req, db, collectionKey, [row]);
  return Boolean(visible);
}
