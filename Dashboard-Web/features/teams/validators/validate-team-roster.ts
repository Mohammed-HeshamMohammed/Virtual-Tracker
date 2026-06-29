import {
  canBeTeamMember,
  isClientRole,
  TEAM_CLIENT_DENIED_MESSAGE,
} from "@/features/auth/permissions/team-member-assign-policy"

export function validateTeamRoster(memberIds: string[], leadIds: string[]): string | null {
  if (memberIds.length === 0) {
    return "Select at least one team member."
  }
  if (leadIds.length === 0) {
    return "Select at least one team lead."
  }
  if (!leadIds.some((id) => memberIds.includes(id))) {
    return "Team leads must also be selected as members."
  }
  return null
}

/** Reject clients (and other ineligible roles) before save — mirrors backend team policy. */
export function validateTeamMemberRoles(
  memberIds: string[],
  membersById: Map<string, { role?: string; role_name?: string }>,
): string | null {
  for (const id of memberIds) {
    const member = membersById.get(id)
    const role = member?.role_name || member?.role || ""
    if (!canBeTeamMember(role)) {
      return isClientRole(role) ? TEAM_CLIENT_DENIED_MESSAGE : "This member cannot be assigned to a team."
    }
  }
  return null
}
