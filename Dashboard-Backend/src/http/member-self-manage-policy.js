import { ROLE_PRIVILEGE_RANK, normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/** Employee L2 and below (L2, L1, L0, Client, Viewer) — self-manage info/settings only. */
export function isLimitedSelfManageRole(roleName) {
  const rank = ROLE_PRIVILEGE_RANK[normalizeRoleKey(roleName)] ?? -1;
  return rank <= (ROLE_PRIVILEGE_RANK.employeel2 ?? 50);
}
