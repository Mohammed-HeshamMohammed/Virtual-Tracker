import { isManagementRole } from "./auth-context.js";
import {
  normalizeRoleKey,
  rolePrivilegeRank,
  ROLE_PRIVILEGE_RANK,
} from "../modules/members/services/relation-sync.js";

/**
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function hasManageEmployeeTeamsPrivilege(memberData) {
  const priv = memberData?.privileges;
  return Boolean(priv && typeof priv === "object" && priv.manage_employee_teams === true);
}

/** Team Lead+ (below Manager). */
export function isEmployeeL2OrHigherRole(roleName) {
  const rank = rolePrivilegeRank(roleName);
  return rank >= ROLE_PRIVILEGE_RANK.teamlead && rank < ROLE_PRIVILEGE_RANK.manager;
}

/** Management roles, or Team Lead+ with manage_employee_teams privilege. */
export function canCreateTeams(roleName, memberData = null) {
  if (isManagementRole(roleName)) return true;
  if (!hasManageEmployeeTeamsPrivilege(memberData)) return false;
  return isEmployeeL2OrHigherRole(roleName);
}

/** Clients cannot join teams. */
export function isClientRole(roleName) {
  return normalizeRoleKey(roleName) === "client";
}

/** Roster-eligible roles (no clients/viewers). */
export function canBeTeamMember(roleName) {
  const key = normalizeRoleKey(roleName);
  if (!key || key === "viewer" || key === "user" || key === "client") return false;
  return true;
}

export const TEAM_CLIENT_DENIED_MESSAGE = "Clients cannot be assigned to teams.";

export const TEAM_INELIGIBLE_MEMBER_MESSAGE = "This member cannot be assigned to a team.";

/** Team roster eligibility check (throws on deny). */
export function assertCanBeTeamMemberRole(roleName) {
  if (canBeTeamMember(roleName)) return;
  const err = new Error(isClientRole(roleName) ? TEAM_CLIENT_DENIED_MESSAGE : TEAM_INELIGIBLE_MEMBER_MESSAGE);
  err.statusCode = 403;
  throw err;
}

/** Target role must be at or below actor rank. */
export function canAssignMemberToTeam(actorRoleName, targetRoleName) {
  const actorKey = normalizeRoleKey(actorRoleName);
  const targetKey = normalizeRoleKey(targetRoleName);
  if (!actorKey || !targetKey) return false;
  if (!canBeTeamMember(targetRoleName)) return false;

  const actorRank = rolePrivilegeRank(actorRoleName);
  const targetRank = rolePrivilegeRank(targetRoleName);
  if (actorRank < 0 || targetRank < 0) return false;
  return targetRank <= actorRank;
}

export const TEAM_MEMBER_ASSIGN_DENIED_MESSAGE =
  "Cannot assign a member above your role to this team.";

/** Team lead must be Team Lead+ (management counts). */
export function canBeTeamLead(roleName) {
  const rank = rolePrivilegeRank(roleName);
  if (rank < 0) return false;
  return rank >= ROLE_PRIVILEGE_RANK.teamlead;
}

export const TEAM_LEAD_ROLE_DENIED_MESSAGE =
  "Employees below Team Lead cannot be assigned as team leads.";
