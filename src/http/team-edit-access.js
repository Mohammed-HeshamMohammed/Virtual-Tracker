import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";
import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { getManageableMemberIds, getVisibleMemberIds } from "../modules/member-relationships/service.js";
import { isEmployeeRole } from "./role-hierarchy.js";
import { canAccessMember } from "./authorization.js";
import { canBeTeamMember } from "./team-member-assign-policy.js";

/** Owner-tier roles can manage any team. */
export function canManageAllTeams(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin" || key === "supermanager" || key === "supermanger";
}

/** Manager: subtree-scoped team create; full control on teams they lead. */
export function isManagerRole(roleName) {
  return normalizeRoleKey(roleName) === "manager";
}

/** All employee-tier member ids (org-wide). */
export async function getOrgWideEmployeeMemberIds(db) {
  const [membersSnap, rolesSnap] = await Promise.all([
    db.collection("members").limit(2000).get(),
    db.collection("roles").limit(100).get(),
  ]);
  const employeeRoleIds = new Set();
  for (const doc of rolesSnap.docs) {
    const name = typeof doc.data()?.name === "string" ? doc.data().name : "";
    if (isEmployeeRole(name)) employeeRoleIds.add(doc.id);
  }
  const ids = [];
  for (const doc of membersSnap.docs) {
    const roleId = doc.data()?.role_id;
    if (typeof roleId === "string" && employeeRoleIds.has(roleId)) ids.push(doc.id);
  }
  return ids;
}

/**
 * Manager staffing pool: subtree + org employees.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 * @param {string} viewerRoleName
 * @param {string} targetMemberId
 * @param {string} targetRoleName
 */
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

  const snap = await db.collection("members").doc(targetMemberId).get();
  return snap.exists;
}

/**
 * Team picker member ids for viewer (null = unrestricted).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 */
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

/**
 * Team staffing picker rows (Manager subtree + org employees).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 */
export async function getTeamStaffableMemberSummaries(db, memberId, roleName) {
  const ids = await getTeamStaffableMemberIds(db, memberId, roleName);
  if (ids === null) return null;

  const summaries = [];
  for (const id of ids) {
    const snap = await db.collection("members").doc(id).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const memberRoleName = await resolveMemberRoleName(db, id);
    if (!canBeTeamMember(memberRoleName)) continue;
    summaries.push({
      id,
      first_name: typeof data.first_name === "string" ? data.first_name : "",
      last_name: typeof data.last_name === "string" ? data.last_name : "",
      work_email: typeof data.work_email === "string" ? data.work_email : "",
      role_name: memberRoleName,
      avatar: typeof data.avatar === "string" ? data.avatar : "",
      avatar_color: typeof data.avatar_color === "string" ? data.avatar_color : "",
      avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : "",
    });
  }
  return summaries;
}
/**
 * @param {string} entityKey
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} existingData
 * @param {string | undefined} resourceId
 */
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} teamId
 */
export async function teamHasMembers(db, teamId) {
  const snap = await db.collection("team_members").where("team_id", "==", teamId).limit(1).get();
  return !snap.empty;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function getTeamIdsLedByMember(db, memberId) {
  if (!memberId) return new Set();
  const snap = await db.collection("team_members").where("member_id", "==", memberId).limit(200).get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    if (row.is_lead !== true) continue;
    const teamId = typeof row.team_id === "string" ? row.team_id : "";
    if (teamId) ids.add(teamId);
  }
  return ids;
}

/**
 * Owner-tier or team lead can edit team data. Managers only via lead flag.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @param {string} teamId
 */
export async function canEditTeam(db, memberId, roleName, teamId) {
  if (!teamId || !memberId) return false;
  if (canManageAllTeams(roleName)) return true;

  const snap = await db.collection("team_members").where("team_id", "==", teamId).limit(200).get();
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    if (row.member_id === memberId && row.is_lead === true) return true;
  }
  return false;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} teamId
 * @param {string} targetMemberId
 */
export async function isMemberOnTeam(db, teamId, targetMemberId) {
  if (!teamId || !targetMemberId) return false;
  const snap = await db
    .collection("team_members")
    .where("team_id", "==", teamId)
    .where("member_id", "==", targetMemberId)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} teamId
 * @param {string} projectId
 */
export async function isProjectOnTeam(db, teamId, projectId) {
  if (!teamId || !projectId) return false;
  const snap = await db
    .collection("team_projects")
    .where("team_id", "==", teamId)
    .where("project_id", "==", projectId)
    .limit(1)
    .get();
  return !snap.empty;
}

/** Team roster assign: visible member or existing roster row when editing. */
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
