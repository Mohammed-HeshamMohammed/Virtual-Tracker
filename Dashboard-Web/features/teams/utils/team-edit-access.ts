import { canManageAllTeams, isManagerRole } from "@/features/auth/permissions/role-hierarchy"

export { canManageAllTeams, isManagerRole }

type TeamWithMembers = {
  members: Array<{ id: string; is_lead?: boolean }>
}

/**
 * Org Owner-tier roles or assigned team lead may edit a team (UI hint — backend enforces).
 * Managers only get lead-based edit access, not org-wide team management.
 */
export function canEditTeam(
  team: TeamWithMembers,
  memberId: string,
  roleName: string,
): boolean {
  if (canManageAllTeams(roleName)) return true
  if (!memberId) return false
  return team.members.some((member) => member.id === memberId && member.is_lead === true)
}
