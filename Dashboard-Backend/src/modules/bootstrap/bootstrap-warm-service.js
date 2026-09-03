
import { isManagementRole } from "../../http/auth-context.js";
import { getViewerProjectIds, toAllowedProjectSet } from "../../http/project-access.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { normalizeDoc } from "../schema/services/schema-crud.service.js";
import { enrichMembersWithRoleNames } from "../members/services/relation-sync.js";
import { fetchMemberDocsByIds } from "../members/services/member-list-fetch.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { listTeamsPg, listAllTeamMembersPg } from "../../lib/postgres/teams-postgres.service.js";

const LIST_LIMIT = 200;

async function fetchPgCollectionList(table) {
  const rows = await pgQuery(`SELECT * FROM ${table}`);
  return rows.map((row) => normalizeDoc(row));
}

async function fetchMemberDocs(db, docIds) {
  const snaps = await fetchMemberDocsByIds(db, docIds);
  return snaps.map((snap) => normalizeDoc({ id: snap.id, ...snap.data() }));
}

function projectAllowed(allowedProjects, projectId) {
  if (!projectId) return false;
  if (allowedProjects === null) return true;
  return allowedProjects.has(projectId);
}

function rowProjectId(row) {
  return String(row.project_id ?? row.projectId ?? "").trim();
}

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
    fetchPgCollectionList("projects"),
    fetchPgCollectionList("project_budgets"),
    fetchPgCollectionList("project_members"),
    fetchPgCollectionList("team_projects"),
    fetchPgCollectionList("project_member_limits"),
    listTeamsPg().then((rows) => rows.map((row) => normalizeDoc(row))),
    listAllTeamMembersPg().then((rows) => rows.map((row) => normalizeDoc(row))),
    fetchPgCollectionList("tasks"),
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
    const rows = await listMembersPg({ limit: LIST_LIMIT });
    members = rows.map((row) => normalizeDoc(row));
    members = await enrichMembersWithRoleNames(db, members);
  } else if (visibleIds.length > 0) {
    members = await fetchMemberDocs(db, visibleIds);
    members = await enrichMembersWithRoleNames(db, members);
  }

  let invites = null;
  if (management) {
    const inviteRows = await pgQuery("SELECT * FROM invites LIMIT $1", [LIST_LIMIT]);
    invites = inviteRows.map((row) => normalizeDoc(row));
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
