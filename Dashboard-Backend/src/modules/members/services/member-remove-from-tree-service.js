import { isOwnerRole, OWNER_REMOVE_BLOCKED_MESSAGE } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { removeMemberHierarchyRelationships } from "../../member-relationships/service.js";
import { syncMemberHierarchyStatus } from "../../hierarchy/hierarchy-sync.js";
import { alignMemberRoleTables, syncMemberPrimaryRole } from "./relation-sync.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { getMemberByIdPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";

async function unassignMemberFromTasks(db, memberId, actorMemberId) {
  const rows = await pgQuery(
    "UPDATE tasks SET assigned_to = NULL, updated_by = $2, updated_at = now() WHERE assigned_to = $1 RETURNING id",
    [memberId, actorMemberId],
  );
  return rows.length;
}

export async function removeMemberFromTree(db, input) {
  const memberId = typeof input.memberId === "string" ? input.memberId.trim() : "";
  const actorMemberId = typeof input.actorMemberId === "string" ? input.actorMemberId.trim() : "";
  const actorRoleName = typeof input.actorRoleName === "string" ? input.actorRoleName : "";

  if (!memberId) {
    throw Object.assign(new Error("memberId is required."), { status: 400 });
  }
  if (memberId === actorMemberId) {
    throw Object.assign(
      new Error("You cannot remove yourself from the tree here. Use Settings or Profile for self-removal."),
      { status: 400 },
    );
  }

  const member = await getMemberByIdPg(memberId);
  if (!member) {
    throw Object.assign(new Error("Member not found."), { status: 404 });
  }

  const currentRole = await resolveMemberRoleName(db, memberId);
  if (isOwnerRole(currentRole)) {
    throw Object.assign(new Error(OWNER_REMOVE_BLOCKED_MESSAGE), { status: 403 });
  }

  const hierarchyEdgesRemoved = await removeMemberHierarchyRelationships(db, memberId);

  const teamRes = await pgQuery("DELETE FROM team_members WHERE member_id = $1 RETURNING id", [memberId]);
  const projectRes = await pgQuery("DELETE FROM project_members WHERE member_id = $1 RETURNING id", [memberId]);
  // Their member limits went with the projects they were on.
  await pgQuery("DELETE FROM project_member_limits WHERE member_id = $1", [memberId]);
  const teamLinksRemoved = teamRes.length;
  const projectLinksRemoved = projectRes.length;

  const tasksUnassigned = await unassignMemberFromTasks(db, memberId, actorMemberId);

  await syncMemberPrimaryRole(db, memberId, "Viewer", actorMemberId, actorRoleName);
  await alignMemberRoleTables(db, memberId, actorMemberId);
  await syncMemberHierarchyStatus(db, memberId, "Viewer");

  await updateMemberPg(memberId, {
    hierarchy_status: "unassigned",
    hierarchy_status_updated_at: new Date().toISOString(),
    privileged_role_owner_granted: false,
    updated_at: new Date().toISOString(),
    updated_by: actorMemberId,
  });

  return {
    memberId,
    previousRole: currentRole,
    role: "Viewer",
    hierarchyStatus: "unassigned",
    hierarchyEdgesRemoved,
    teamLinksRemoved,
    projectLinksRemoved,
    tasksUnassigned,
  };
}

export async function batchRemoveMembersFromTree(db, input) {
  const memberIds = Array.isArray(input.memberIds)
    ? [...new Set(input.memberIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 100)
    : [];
  if (!memberIds.length) {
    throw Object.assign(new Error("memberIds must be a non-empty array."), { status: 400 });
  }

  const results = [];
  for (const memberId of memberIds) {
    const row = await removeMemberFromTree(db, {
      memberId,
      actorMemberId: input.actorMemberId,
      actorRoleName: input.actorRoleName,
    });
    results.push(row);
  }
  return { removed: results.length, results };
}
