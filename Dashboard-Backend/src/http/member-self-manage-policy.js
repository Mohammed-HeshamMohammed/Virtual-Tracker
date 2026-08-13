import { ROLE_PRIVILEGE_RANK, normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/** Team Lead and below (Team Lead, Employee, Intern, Client, Viewer) — self-manage info/settings only. */
export function isLimitedSelfManageRole(roleName) {
  const rank = ROLE_PRIVILEGE_RANK[normalizeRoleKey(roleName)] ?? -1;
  return rank <= (ROLE_PRIVILEGE_RANK.teamlead ?? 50);
}
