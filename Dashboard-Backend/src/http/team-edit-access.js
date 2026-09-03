import { normalizeRoleKey, resolveRoleIdsWhere } from "../modules/members/services/relation-sync.js";
import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { getManageableMemberIds, getVisibleMemberIds } from "../modules/member-relationships/service.js";
import { isEmployeeRole } from "./role-hierarchy.js";
import { canViewEmail } from "./field-policy.js";
import { canAccessMember } from "./authorization.js";
import { canBeTeamMember } from "./team-member-assign-policy.js";
import { listTeamIdsForProjectPg } from "../lib/postgres/projects-postgres.service.js";
import { getMemberByIdPg, getMembersByIdsPg, listMembersPg } from "../lib/postgres/members-postgres.service.js";
import { listTeamMembersPg } from "../lib/postgres/teams-postgres.service.js";
import { query as pgQuery } from "../lib/postgres/client.js";

export function canManageAllTeams(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin" || key === "supermanager" || key === "supermanger";
}

export function isManagerRole(roleName) {
  return normalizeRoleKey(roleName) === "manager";
}

export async function getOrgWideEmployeeMemberIds(db) {
  const [members, employeeRoleIdList] = await Promise.all([
    listMembersPg(),
    resolveRoleIdsWhere(isEmployeeRole),
  ]);
  const employeeRoleIds = new Set(employeeRoleIdList);
  const ids = [];
  for (const m of members) {
    if (m.role_id && employeeRoleIds.has(m.role_id)) ids.push(m.id);
  }
  return ids;
}

export async function isManagerTeamStaffableMember(
  db,
  viewerMemberId,
  viewerRoleName,
  targetMemberId,
  targetRoleName,
) {
  if (!isManagerRole(viewerRoleName) || !targetMemberId) return false;
  if (!canBeTeamMember(targetRoleName)) return false;

  const manageable = await getManageableMemberIds(db, viewerMemberId, viewerRoleName);
  if (manageable !== null && manageable.includes(targetMemberId)) return true;
  if (!isEmployeeRole(targetRoleName)) return false;

  const member = await getMemberByIdPg(targetMemberId);
  return Boolean(member);
}

export async function getTeamStaffableMemberIds(db, memberId, roleName) {
  if (canManageAllTeams(roleName)) return null;
  if (isManagerRole(roleName)) {
    const [manageable, employeeIds] = await Promise.all([
      getManageableMemberIds(db, memberId, roleName),
      getOrgWideEmployeeMemberIds(db),
    ]);
    return [...new Set([memberId, ...(manageable || []), ...employeeIds])];
  }
  return getVisibleMemberIds(db, memberId, roleName);
}

export async function getTeamStaffableMemberSummaries(db, memberId, roleName) {
  const ids = await getTeamStaffableMemberIds(db, memberId, roleName);
  if (ids === null) return null;

  const members = await getMembersByIdsPg(ids);
  const summaries = [];
  for (const m of members) {
    const memberRoleName = await resolveMemberRoleName(db, m.id);
    if (!canBeTeamMember(memberRoleName)) continue;
    summaries.push({
      id: m.id,
      first_name: m.first_name || "",
      last_name: m.last_name || "",
      work_email: canViewEmail({ memberId, roleName }, String(m.id)) ? m.work_email || "" : "",
      role_name: memberRoleName,
      avatar: m.avatar || "",
      avatar_color: m.avatar_color || "",
      avatar_url: m.avatar_url || "",
    });
  }
  return summaries;
}

export function resolveTeamIdFromWrite(entityKey, body, existingData, resourceId) {
  if (entityKey === "teams") {
    return (
      (typeof resourceId === "string" && resourceId) ||
      (typeof body.id === "string" && body.id) ||
      (typeof existingData?.id === "string" && existingData.id) ||
      ""
    );
  }
  return (
    (typeof body.team_id === "string" && body.team_id) ||
    (typeof body.teamId === "string" && body.teamId) ||
    (typeof existingData?.team_id === "string" && existingData.team_id) ||
    ""
  );
}

export async function teamHasMembers(db, teamId) {
  if (!teamId) return false;
  const rows = await pgQuery("SELECT 1 FROM team_members WHERE team_id = $1 LIMIT 1", [teamId]);
  return rows.length > 0;
}

export async function getTeamIdsLedByMember(db, memberId) {
  if (!memberId) return new Set();
  const rows = await pgQuery("SELECT team_id FROM team_members WHERE member_id = $1 AND (is_lead = true OR role = 'lead')", [memberId]);
  return new Set(rows.map((r) => r.team_id).filter(Boolean));
}

export async function canEditTeam(db, memberId, roleName, teamId) {
  if (!teamId || !memberId) return false;
  if (canManageAllTeams(roleName)) return true;

  const rows = await pgQuery("SELECT 1 FROM team_members WHERE team_id = $1 AND member_id = $2 AND (is_lead = true OR role = 'lead') LIMIT 1", [teamId, memberId]);
  return rows.length > 0;
}

export async function isMemberOnTeam(db, teamId, targetMemberId) {
  if (!teamId || !targetMemberId) return false;
  const rows = await pgQuery("SELECT 1 FROM team_members WHERE team_id = $1 AND member_id = $2 LIMIT 1", [teamId, targetMemberId]);
  return rows.length > 0;
}

export async function isProjectOnTeam(db, teamId, projectId) {
  if (!teamId || !projectId) return false;
  const teamIds = await listTeamIdsForProjectPg(projectId);
  return teamIds.includes(teamId);
}

export async function canAssignMemberToTeamRoster(
  db,
  viewerMemberId,
  viewerRoleName,
  teamId,
  targetMemberId,
) {
  if (!targetMemberId) return false;
  const targetRoleName = await resolveMemberRoleName(db, targetMemberId);
  if (!canBeTeamMember(targetRoleName)) return false;
  if (await canAccessMember(db, viewerMemberId, viewerRoleName, targetMemberId)) return true;
  if (!teamId) return false;
  if (!(await canEditTeam(db, viewerMemberId, viewerRoleName, teamId))) return false;
  return isMemberOnTeam(db, teamId, targetMemberId);
}

