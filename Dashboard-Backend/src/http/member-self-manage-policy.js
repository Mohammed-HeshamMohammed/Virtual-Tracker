import { ROLE_PRIVILEGE_RANK, normalizeRoleKey } from "../modules/members/services/relation-sync.js";

export function isLimitedSelfManageRole(roleName) {
  const rank = ROLE_PRIVILEGE_RANK[normalizeRoleKey(roleName)] ?? -1;
  return rank <= (ROLE_PRIVILEGE_RANK.teamlead ?? 50);
}
