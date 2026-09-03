import { rolePrivilegeRank } from "../modules/members/services/relation-sync.js";
import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { isOwnerRole, OWNER_REMOVE_BLOCKED_MESSAGE } from "./role-owner-policy.js";

const MANAGER_RANK = rolePrivilegeRank("Manager");

export const BATCH_MEMBER_ACTIONS_DENIED_MESSAGE =
  "Batch member actions require Manager or higher privileges.";

export function canUseBatchMemberActions(roleName) {
  return rolePrivilegeRank(roleName) >= MANAGER_RANK;
}

export async function assertMembersRemovable(db, memberIds) {
  for (const id of memberIds) {
    const role = await resolveMemberRoleName(db, id);
    if (isOwnerRole(role)) return OWNER_REMOVE_BLOCKED_MESSAGE;
  }
  return null;
}
