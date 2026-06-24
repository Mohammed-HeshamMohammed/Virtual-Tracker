import { isEmployeeRole, isManagementRole } from "@/features/auth"
import type { TeamMember } from "@/features/teams/api/team-api"

export type ProjectMemberLists = {
  teams: string[]
  managers: string[]
  users: string[]
}

export function memberIdsForTeams(selectedTeamIds: string[], allTeamMembers: TeamMember[]): string[] {
  const selected = new Set(selectedTeamIds)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of allTeamMembers) {
    if (!selected.has(row.team_id)) continue
    const memberId = row.member_id?.trim()
    if (!memberId || seen.has(memberId)) continue
    seen.add(memberId)
    ids.push(memberId)
  }
  return ids
}

function resolveMemberRole(
  memberId: string,
  roleByMemberId: ReadonlyMap<string, string>,
  teamMemberRoleById: ReadonlyMap<string, string>,
): string {
  return roleByMemberId.get(memberId) ?? teamMemberRoleById.get(memberId) ?? ""
}

export function partitionMemberIdsByProjectRole(
  memberIds: string[],
  roleByMemberId: ReadonlyMap<string, string>,
  teamMemberRoleById: ReadonlyMap<string, string>,
): Pick<ProjectMemberLists, "managers" | "users"> {
  const managers: string[] = []
  const users: string[] = []
  const seen = new Set<string>()

  for (const memberId of memberIds) {
    if (!memberId || seen.has(memberId)) continue
    seen.add(memberId)
    const role = resolveMemberRole(memberId, roleByMemberId, teamMemberRoleById)
    if (isManagementRole(role)) {
      managers.push(memberId)
    } else if (isEmployeeRole(role)) {
      users.push(memberId)
    }
  }

  return { managers, users }
}

function buildTeamMemberRoleMap(allTeamMembers: TeamMember[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of allTeamMembers) {
    const memberId = row.member_id?.trim()
    const role = row.member_role?.trim()
    if (memberId && role && !map.has(memberId)) {
      map.set(memberId, role)
    }
  }
  return map
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])]
}

/** Sync manager / employee picks when project teams change. */
export function syncProjectMembersFromTeams(
  prev: ProjectMemberLists,
  nextTeamIds: string[],
  allTeamMembers: TeamMember[],
  roleByMemberId: ReadonlyMap<string, string>,
): ProjectMemberLists {
  const teamMemberRoleById = buildTeamMemberRoleMap(allTeamMembers)
  const prevRoster = new Set(memberIdsForTeams(prev.teams, allTeamMembers))
  const nextRoster = memberIdsForTeams(nextTeamIds, allTeamMembers)
  const nextRosterSet = new Set(nextRoster)
  const removed = [...prevRoster].filter((id) => !nextRosterSet.has(id))
  const removedSet = new Set(removed)
  const partitioned = partitionMemberIdsByProjectRole(nextRoster, roleByMemberId, teamMemberRoleById)

  const stripRemoved = (ids: string[]) => ids.filter((id) => !removedSet.has(id))

  return {
    teams: nextTeamIds,
    managers: mergeUnique(stripRemoved(prev.managers), partitioned.managers),
    users: mergeUnique(stripRemoved(prev.users), partitioned.users),
  }
}
