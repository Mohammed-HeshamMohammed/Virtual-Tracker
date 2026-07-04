// Warm bundle for list caches after login (same visibility rules as member-relationships / project-access).

import { isManagementRole } from "../../http/auth-context.js";
import { getViewerProjectIds, toAllowedProjectSet } from "../../http/project-access.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { normalizeDoc } from "../schema/services/schema-crud.service.js";
import { enrichMembersWithRoleNames } from "../members/services/relation-sync.js";
import { fetchMemberDocsByIds } from "../members/services/member-list-fetch.js";

const LIST_LIMIT = 200;

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string[]} docIds
 */
async function fetchDocsByIds(db, collection, docIds) {
  if (collection === "members") {
    return fetchMemberDocsByIds(db, docIds).then((snaps) =>
      snaps.map((snap) => normalizeDoc({ id: snap.id, ...snap.data() })),
    );
  }
  if (!docIds.length) return [];
  const unique = [...new Set(docIds.filter(Boolean))];
  const snaps = [];
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10).map((id) => db.collection(collection).doc(id));
    snaps.push(...(await db.getAll(...batch)));
  }
  return snaps.filter((snap) => snap.exists).map((snap) => normalizeDoc({ id: snap.id, ...snap.data() }));
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {number} limit
 */
async function fetchCollectionList(db, collection, limit = LIST_LIMIT) {
  const snap = await db.collection(collection).limit(limit).get();
  return snap.docs.map((doc) => normalizeDoc({ id: doc.id, ...doc.data() }));
}

/**
 * @param {Set<string> | null} allowedProjects
 * @param {string} projectId
 */
function projectAllowed(allowedProjects, projectId) {
  if (!projectId) return false;
  if (allowedProjects === null) return true;
  return allowedProjects.has(projectId);
}

/**
 * @param {Record<string, unknown>} row
 */
function rowProjectId(row) {
  return String(row.project_id ?? row.projectId ?? "").trim();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 */
export async function getBootstrapWarmPayload(db, viewer) {
  const roleName = viewer.roleName || "";
  const management = isManagementRole(roleName);
  const allowedProjects = toAllowedProjectSet(await getViewerProjectIds(db, viewer.memberId, roleName));

  const [
    visibleIds,
    projectsRaw,
    projectBudgetsRaw,
    projectMembersRaw,
    teamProjectsRaw,
    projectMemberLimitsRaw,
    teams,
    teamMembers,
    tasksRaw,
  ] = await Promise.all([
    getVisibleMemberIds(db, viewer.memberId, roleName),
    fetchCollectionList(db, "projects"),
    fetchCollectionList(db, "project_budgets"),
    fetchCollectionList(db, "project_members"),
    fetchCollectionList(db, "team_projects"),
    fetchCollectionList(db, "project_member_limits"),
    fetchCollectionList(db, "teams"),
    fetchCollectionList(db, "team_members"),
    fetchCollectionList(db, "tasks"),
  ]);

  const projects = projectsRaw.filter((row) => projectAllowed(allowedProjects, row.id));
  const projectBudgets = projectBudgetsRaw.filter((row) => projectAllowed(allowedProjects, rowProjectId(row)));
  const projectMembers = projectMembersRaw.filter((row) => projectAllowed(allowedProjects, rowProjectId(row)));
  const projectMemberLimits = projectMemberLimitsRaw.filter((row) => projectAllowed(allowedProjects, rowProjectId(row)));
  const tasks = tasksRaw.filter((row) => projectAllowed(allowedProjects, rowProjectId(row)));

  const teamIds = [
    ...new Set(
      teamProjectsRaw
        .map((row) => String(row.team_id ?? row.teamId ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const teamNameById = new Map(teams.map((team) => [String(team.id), String(team.name ?? team.id)]));

  const teamProjectLinks = teamProjectsRaw.flatMap((row) => {
    const projectId = rowProjectId(row);
    if (!projectAllowed(allowedProjects, projectId)) return [];
    const teamId = String(row.team_id ?? row.teamId ?? "").trim();
    return [
      {
        id: String(row.id ?? ""),
        project_id: projectId,
        team_id: teamId,
        team_name: teamNameById.get(teamId) ?? teamId,
      },
    ];
  });

  const teamProjects = teamProjectsRaw.filter((row) => projectAllowed(allowedProjects, rowProjectId(row)));

  let members = [];
  if (visibleIds === null) {
    const snap = await db.collection("members").orderBy("date_added", "desc").limit(LIST_LIMIT).get();
    members = snap.docs.map((doc) => normalizeDoc({ id: doc.id, ...doc.data() }));
    members = await enrichMembersWithRoleNames(db, members);
  } else if (visibleIds.length > 0) {
    members = await fetchDocsByIds(db, "members", visibleIds);
    members = await enrichMembersWithRoleNames(db, members);
  }

  let invites = null;
  if (management) {
    invites = await fetchCollectionList(db, "invites");
    if (visibleIds !== null && typeof viewer.uid === "string" && viewer.uid) {
      invites = invites.filter((row) => row.created_by_uid === viewer.uid);
    }
  }

  const scopedMembers =
    visibleIds === null
      ? { member_id: viewer.memberId, members: null, sees_all: true }
      : { member_id: viewer.memberId, members: visibleIds, sees_all: false };

  return {
    members,
    projects,
    projectBudgets,
    projectMembers,
    teamProjectLinks,
    projectMemberLimits,
    teams,
    teamMembers,
    teamProjects,
    tasks,
    invites,
    scopedMembers,
  };
}
