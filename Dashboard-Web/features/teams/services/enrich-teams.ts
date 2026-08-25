import {
  getTeams,
  getTeamMembers,
  getTeamProjects,
} from "@/features/teams/api/team-api"
import { getProjects } from "@/features/projects/api/project-api"
import {
  TEAM_MEMBERS_LIST_API_FIELDS,
  TEAM_PROJECTS_LIST_API_FIELDS,
  TEAMS_LIST_API_FIELDS,
  PROJECTS_NAME_LIST_API_FIELDS,
} from "@/features/members/components/list-api-fields"
import type { TeamWithRelations } from "@/features/teams/models/team"

export type EnrichedTeam = TeamWithRelations

function groupByTeamId<T extends { team_id?: string; teamId?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const teamId = row.team_id || row.teamId || ""
    if (!teamId) continue
    const bucket = map.get(teamId) || []
    bucket.push(row)
    map.set(teamId, bucket)
  }
  return map
}

function resolveProjectId(row: { project_id?: string; projectId?: string }): string {
  return row.project_id || row.projectId || ""
}

export async function fetchEnrichedTeams(): Promise<EnrichedTeam[]> {
  const [teamsData, teamMembersData, teamProjectsData] = await Promise.all([
    getTeams({ fields: [...TEAMS_LIST_API_FIELDS] }),
    getTeamMembers(undefined, { fields: [...TEAM_MEMBERS_LIST_API_FIELDS] }),
    getTeamProjects(undefined, { fields: [...TEAM_PROJECTS_LIST_API_FIELDS] }),
  ])

  const membersByTeam = groupByTeamId(teamMembersData)
  const projectsByTeam = groupByTeamId(teamProjectsData)

  const linkedProjectIds = [
    ...new Set(teamProjectsData.map(resolveProjectId).filter(Boolean)),
  ]

  const projectsCatalog =
    linkedProjectIds.length > 0
      ? await getProjects({ fields: [...PROJECTS_NAME_LIST_API_FIELDS] })
      : []
  const projectNameById = new Map(projectsCatalog.map((project) => [project.id, project.name]))

  return teamsData.map((team) => {
    const memberRelations = membersByTeam.get(team.id) || []
    const projectRelations = projectsByTeam.get(team.id) || []

    const members = memberRelations.map((mr) => {
      const apiName = typeof mr.member_name === "string" ? mr.member_name : ""
      // member_avatar_url is a photo URL, not initials - `avatar` feeds
      // AvatarStack's text slot, so initials are always derived from the name
      // and the URL rides in avatarUrl for the image to render from.
      const apiAvatarUrl = typeof mr.member_avatar_url === "string" ? mr.member_avatar_url : undefined
      const apiColor = typeof mr.member_color === "string" ? mr.member_color : undefined
      const apiRole = typeof mr.member_role === "string" ? mr.member_role : ""
      const displayName = apiName || "Unknown"
      const initials =
        displayName
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "?"
      return {
        id: mr.member_id,
        name: displayName,
        avatar: initials,
        color: apiColor || "#6366f1",
        avatarUrl: apiAvatarUrl || undefined,
        role: apiRole,
        is_lead: mr.is_lead,
      }
    })

    const leads = members.filter((member) => member.is_lead).map((member) => member.name)

    const projects = projectRelations.map((pr) => {
      const projectId = resolveProjectId(pr)
      const apiName = typeof pr.project_name === "string" ? pr.project_name.trim() : ""
      const catalogName = projectId ? projectNameById.get(projectId)?.trim() : ""
      const name = apiName || catalogName || ""
      return {
        id: projectId,
        name: name || "Unknown Project",
      }
    })

    return {
      ...team,
      members,
      projects,
      leads,
    }
  })
}
