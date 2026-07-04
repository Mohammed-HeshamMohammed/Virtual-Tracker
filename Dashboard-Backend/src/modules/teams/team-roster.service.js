import { canAccessMember } from "../../http/authorization.js";
import { getViewerProjectIds } from "../../http/project-access.js";
import {
  canAssignMemberToTeamRoster,
  canEditTeam,
  canManageAllTeams,
  isManagerRole,
  isManagerTeamStaffableMember,
  isProjectOnTeam,
} from "../../http/team-edit-access.js";
import {
  canAssignMemberToTeam,
  canBeTeamLead,
  assertCanBeTeamMemberRole,
  TEAM_LEAD_ROLE_DENIED_MESSAGE,
  TEAM_MEMBER_ASSIGN_DENIED_MESSAGE,
} from "../../http/team-member-assign-policy.js";
import { getManageableMemberIds } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { generateUUID, now } from "../schema/catalog/index.js";
import { applyTeamWriteMetadata, validateForeignKeys } from "../schema/services/schema-crud.service.js";

export function validateTeamRoster(memberIds, leadIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return "At least one team member is required.";
  }
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return "At least one team lead is required.";
  }
  const memberSet = new Set(memberIds);
  if (!leadIds.some((id) => memberSet.has(id))) {
    return "Team leads must also be included as team members.";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ memberIds: string[], leadIds: Set<string>, projectIds: string[] }}
 */
export function parseTeamRosterInput(body) {
  const memberIds = [];
  const leadIds = new Set();

  if (Array.isArray(body.members)) {
    for (const row of body.members) {
      if (!row || typeof row !== "object") continue;
      const memberId = typeof row.member_id === "string" ? row.member_id.trim() : "";
      if (!memberId) continue;
      memberIds.push(memberId);
      if (row.is_lead === true) leadIds.add(memberId);
    }
  } else {
    const rawMemberIds = body.member_ids ?? body.memberIds;
    if (Array.isArray(rawMemberIds)) {
      for (const id of rawMemberIds) {
        if (typeof id === "string" && id.trim()) memberIds.push(id.trim());
      }
    }
    const rawLeadIds = body.lead_ids ?? body.leadIds;
    if (Array.isArray(rawLeadIds)) {
      for (const id of rawLeadIds) {
        if (typeof id === "string" && id.trim()) leadIds.add(id.trim());
      }
    }
  }

  const seen = new Set();
  const uniqueMemberIds = memberIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const leadId of leadIds) {
    if (!seen.has(leadId)) {
      throw new Error("lead_ids must only reference members included in member_ids");
    }
  }

  const projectIds = [];
  const rawProjectIds = body.project_ids ?? body.projectIds;
  if (Array.isArray(rawProjectIds)) {
    for (const id of rawProjectIds) {
      if (typeof id === "string" && id.trim()) projectIds.push(id.trim());
    }
  }

  return { memberIds: uniqueMemberIds, leadIds, projectIds };
}

const MANAGER_TEAM_STAFF_MESSAGE =
  "Managers can only staff teams with members from their management subtree or employees from the organization.";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string} memberId
 * @param {boolean} isLead
 * @param {{ teamId?: string, enforceSubtreeCreate?: boolean, isNewOnTeam?: boolean }} [options]
 */
async function assertCanAssignTeamRosterMember(db, viewer, memberId, isLead, options = {}) {
  const { teamId = "", enforceSubtreeCreate = false, isNewOnTeam = false } = options;
  const targetRoleName = await resolveMemberRoleName(db, memberId);
  assertCanBeTeamMemberRole(targetRoleName);
  if (!canAssignMemberToTeam(viewer.roleName, targetRoleName)) {
    const err = new Error(TEAM_MEMBER_ASSIGN_DENIED_MESSAGE);
    err.statusCode = 403;
    throw err;
  }
  if (isLead && !canBeTeamLead(targetRoleName)) {
    const err = new Error(TEAM_LEAD_ROLE_DENIED_MESSAGE);
    err.statusCode = 403;
    throw err;
  }

  let allowed;
  if (teamId) {
    allowed = await canAssignMemberToTeamRoster(db, viewer.memberId, viewer.roleName, teamId, memberId);
    if (!allowed && isNewOnTeam && isManagerRole(viewer.roleName)) {
      allowed = await isManagerTeamStaffableMember(
        db,
        viewer.memberId,
        viewer.roleName,
        memberId,
        targetRoleName,
      );
    }
  } else if (isManagerRole(viewer.roleName) && enforceSubtreeCreate) {
    allowed = await isManagerTeamStaffableMember(
      db,
      viewer.memberId,
      viewer.roleName,
      memberId,
      targetRoleName,
    );
  } else {
    allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, memberId);
  }
  if (!allowed) {
    const err = new Error("Cannot assign team members outside your access scope.");
    err.statusCode = 403;
    throw err;
  }

  if (enforceSubtreeCreate && !canManageAllTeams(viewer.roleName)) {
    if (isManagerRole(viewer.roleName)) {
      const staffable = await isManagerTeamStaffableMember(
        db,
        viewer.memberId,
        viewer.roleName,
        memberId,
        targetRoleName,
      );
      if (!staffable) {
        const err = new Error(MANAGER_TEAM_STAFF_MESSAGE);
        err.statusCode = 403;
        throw err;
      }
      return;
    }
    const manageable = await getManageableMemberIds(db, viewer.memberId, viewer.roleName);
    if (manageable !== null && !manageable.includes(memberId)) {
      const err = new Error(MANAGER_TEAM_STAFF_MESSAGE);
      err.statusCode = 403;
      throw err;
    }
  }
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string} projectId
 */
async function assertCanLinkTeamProject(db, viewer, projectId, teamId = "") {
  const allowedProjects = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
  if (allowedProjects === null || allowedProjects.includes(projectId)) return;
  if (teamId && (await canEditTeam(db, viewer.memberId, viewer.roleName, teamId))) {
    if (await isProjectOnTeam(db, teamId, projectId)) return;
  }
  const err = new Error("Cannot link projects outside your access scope.");
  err.statusCode = 403;
  throw err;
}

/** Initial team_members + team_projects on team create. */
export async function createTeamInitialRoster(db, viewer, teamId, roster) {
  if (!viewer?.memberId || !teamId) return;

  const rosterError = validateTeamRoster(roster.memberIds, [...roster.leadIds]);
  if (rosterError) {
    const err = new Error(rosterError);
    err.statusCode = 400;
    throw err;
  }

  for (const memberId of roster.memberIds) {
    await assertCanAssignTeamRosterMember(db, viewer, memberId, roster.leadIds.has(memberId), {
      enforceSubtreeCreate: true,
    });
  }
  for (const projectId of roster.projectIds) {
    await assertCanLinkTeamProject(db, viewer, projectId, teamId);
  }

  const batch = db.batch();

  for (const memberId of roster.memberIds) {
    const payload = {
      id: generateUUID(),
      team_id: teamId,
      member_id: memberId,
      is_lead: roster.leadIds.has(memberId),
    };
    applyTeamWriteMetadata("team-members", payload, viewer.memberId, true);
    await validateForeignKeys(db, payload, { entityKey: "team-members" });
    batch.set(db.collection("team_members").doc(payload.id), payload);
  }

  for (const projectId of roster.projectIds) {
    const payload = {
      id: generateUUID(),
      team_id: teamId,
      project_id: projectId,
      assigned_at: now(),
    };
    applyTeamWriteMetadata("team-projects", payload, viewer.memberId, true);
    await validateForeignKeys(db, payload, { entityKey: "team-projects" });
    batch.set(db.collection("team_projects").doc(payload.id), payload);
  }

  await batch.commit();
}

/** Replace team roster on edit (Owner or team lead). */
export async function syncTeamRoster(db, viewer, teamId, roster) {
  if (!viewer?.memberId || !teamId) return;

  const rosterError = validateTeamRoster(roster.memberIds, [...roster.leadIds]);
  if (rosterError) {
    const err = new Error(rosterError);
    err.statusCode = 400;
    throw err;
  }

  const [existingMembersSnap, existingProjectsSnap] = await Promise.all([
    db.collection("team_members").where("team_id", "==", teamId).get(),
    db.collection("team_projects").where("team_id", "==", teamId).get(),
  ]);

  const existingMemberIds = new Set(
    existingMembersSnap.docs
      .map((doc) => doc.data()?.member_id)
      .filter((id) => typeof id === "string"),
  );

  for (const memberId of roster.memberIds) {
    const isNewMember = !existingMemberIds.has(memberId);
    await assertCanAssignTeamRosterMember(db, viewer, memberId, roster.leadIds.has(memberId), {
      teamId,
      enforceSubtreeCreate: isNewMember && !canManageAllTeams(viewer.roleName),
      isNewOnTeam: isNewMember,
    });
  }
  for (const projectId of roster.projectIds) {
    await assertCanLinkTeamProject(db, viewer, projectId, teamId);
  }

  const batch = db.batch();
  const desiredMemberIds = new Set(roster.memberIds);
  const desiredProjectIds = new Set(roster.projectIds);

  for (const doc of existingMembersSnap.docs) {
    const row = doc.data() || {};
    const memberId = typeof row.member_id === "string" ? row.member_id : "";
    if (!memberId || !desiredMemberIds.has(memberId)) {
      batch.delete(doc.ref);
      continue;
    }
    const shouldLead = roster.leadIds.has(memberId);
    if (row.is_lead !== shouldLead) {
      batch.update(doc.ref, { is_lead: shouldLead, updated_by: viewer.memberId });
    }
  }

  for (const memberId of roster.memberIds) {
    if (existingMemberIds.has(memberId)) continue;
    const payload = {
      id: generateUUID(),
      team_id: teamId,
      member_id: memberId,
      is_lead: roster.leadIds.has(memberId),
    };
    applyTeamWriteMetadata("team-members", payload, viewer.memberId, true);
    await validateForeignKeys(db, payload, { entityKey: "team-members" });
    batch.set(db.collection("team_members").doc(payload.id), payload);
  }

  for (const doc of existingProjectsSnap.docs) {
    const row = doc.data() || {};
    const projectId = typeof row.project_id === "string" ? row.project_id : "";
    if (!projectId || !desiredProjectIds.has(projectId)) {
      batch.delete(doc.ref);
    }
  }

  const existingProjectIds = new Set(
    existingProjectsSnap.docs
      .map((doc) => doc.data()?.project_id)
      .filter((id) => typeof id === "string"),
  );
  for (const projectId of roster.projectIds) {
    if (existingProjectIds.has(projectId)) continue;
    const payload = {
      id: generateUUID(),
      team_id: teamId,
      project_id: projectId,
      assigned_at: now(),
    };
    applyTeamWriteMetadata("team-projects", payload, viewer.memberId, true);
    await validateForeignKeys(db, payload, { entityKey: "team-projects" });
    batch.set(db.collection("team_projects").doc(payload.id), payload);
  }

  await batch.commit();
}
