import { canManageAllTeams, isManagerRole } from "@/features/auth/permissions/role-hierarchy"

export { canManageAllTeams, isManagerRole }

type TeamWithMembers = {
  members: Array<{ id: string; is_lead?: boolean }>
}

export function canEditTeam(
  team: TeamWithMembers,
  memberId: string,
  roleName: string,
): boolean {
  if (canManageAllTeams(roleName)) return true
  if (!memberId) return false
  return team.members.some((member) => member.id === memberId && member.is_lead === true)
}
