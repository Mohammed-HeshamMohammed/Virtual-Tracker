import { normalizeMemberRole } from "@/features/auth/permissions/member-role-access"

const ROLE_PRIVILEGE_RANK: Record<string, number> = Object.assign(Object.create(null), {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
})

function roleRank(roleName: string): number {
  const key = normalizeMemberRole(roleName)
  if (!key) return -1
  return ROLE_PRIVILEGE_RANK[key] ?? -1
}

const MANAGEMENT_ROLE_KEYS = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
  "manager",
])

export function hasManageEmployeeTeamsPrivilege(
  member?: { privileges?: { manage_employee_teams?: boolean } } | null,
): boolean {
  return member?.privileges?.manage_employee_teams === true
}

export function isEmployeeL2OrHigherRole(role: string): boolean {
  const rank = roleRank(role)
  const managerRank = ROLE_PRIVILEGE_RANK.manager ?? 60
  const l2Rank = ROLE_PRIVILEGE_RANK.teamlead ?? 50
  return rank >= l2Rank && rank < managerRank
}

export function canCreateTeams(
  roleName: string,
  member?: { privileges?: { manage_employee_teams?: boolean } } | null,
): boolean {
  const key = normalizeMemberRole(roleName)
  if (MANAGEMENT_ROLE_KEYS.has(key)) return true
  if (!hasManageEmployeeTeamsPrivilege(member)) return false
  return isEmployeeL2OrHigherRole(roleName)
}

export function isClientRole(roleName: string): boolean {
  return normalizeMemberRole(roleName) === "client"
}

export function canBeTeamMember(roleName: string): boolean {
  const key = normalizeMemberRole(roleName)
  if (!key || key === "viewer" || key === "user" || key === "client") return false
  return true
}

export const TEAM_CLIENT_DENIED_MESSAGE = "Clients cannot be assigned to teams."

export function canAssignMemberToTeam(actorRoleName: string, targetRoleName: string): boolean {
  const actorKey = normalizeMemberRole(actorRoleName)
  const targetKey = normalizeMemberRole(targetRoleName)
  if (!actorKey || !targetKey) return false
  if (!canBeTeamMember(targetRoleName)) return false

  const actorRank = roleRank(actorRoleName)
  const targetRank = roleRank(targetRoleName)
  if (actorRank < 0 || targetRank < 0) return false
  return targetRank <= actorRank
}

export function canBeTeamLead(roleName: string): boolean {
  const rank = roleRank(roleName)
  const l2Rank = ROLE_PRIVILEGE_RANK.teamlead ?? 50
  return rank >= l2Rank
}
