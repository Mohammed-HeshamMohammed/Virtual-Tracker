import { getTeamMembers, type TeamMember } from "@/features/teams/api/team-api"

export type MemberLookup = {
  id: string
  name: string
  avatar: string
  color: string
}

export type AssigneeOption = {
  value: string
  label: string
}

function displayNameForMember(
  memberId: string,
  fromLookup: MemberLookup | undefined,
  row: TeamMember,
): string {
  if (fromLookup?.name?.trim()) return fromLookup.name.trim()
  if (row.member_name?.trim()) return row.member_name.trim()
  return "Unknown member"
}

export async function fetchTeamAssigneeOptions(
  teamId: string,
  memberLookups: MemberLookup[],
): Promise<AssigneeOption[]> {
  const memberById = new Map(memberLookups.map((m) => [m.id, m]))
  const rows = await getTeamMembers(teamId)
  const seen = new Set<string>()
  const list: Array<{ id: string; name: string; isLead: boolean }> = []

  for (const row of rows) {
    const memberId = row.member_id
    if (!memberId || seen.has(memberId)) continue
    seen.add(memberId)
    list.push({
      id: memberId,
      name: displayNameForMember(memberId, memberById.get(memberId), row),
      isLead: row.is_lead,
    })
  }

  list.sort((a, b) => {
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return list.map((m) => ({ value: m.id, label: m.name }))
}

export async function buildScopedAssigneeOptions(params: {
  teamId: string | null
  memberLookups: MemberLookup[]
  preserveMemberIds?: string[]
  /** Assignee pool to use when no team is picked - the task's own project
   *  isn't required to be on a team, so "no team selected" must fall back
   *  to the project's members instead of leaving the Assignees field
   *  permanently empty (its only source used to be a team roster). */
  projectMemberLookups?: MemberLookup[]
}): Promise<AssigneeOption[]> {
  const { teamId, memberLookups, preserveMemberIds = [], projectMemberLookups = [] } = params

  const options = teamId
    ? await fetchTeamAssigneeOptions(teamId, memberLookups)
    : [...projectMemberLookups]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ value: m.id, label: m.name }))
  const byValue = new Map(options.map((option) => [option.value, option]))

  for (const memberId of preserveMemberIds) {
    if (!memberId || byValue.has(memberId)) continue
    const member = memberLookups.find((row) => row.id === memberId)
    if (member) byValue.set(memberId, { value: memberId, label: member.name })
  }

  return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label))
}
