import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export interface Team {
  id: string
  name: string
  schedule_weekly_report?: boolean
  created_at?: string
  created_by?: string
  updated_by?: string
}

export interface TeamMember {
  id: string
  team_id: string
  member_id: string
  is_lead: boolean
  joined_at?: string
  assigned_by?: string
  updated_by?: string
  member_name?: string
  member_avatar?: string
  member_email?: string
  member_color?: string
  member_role?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function normalizeTeamMember(input: unknown): TeamMember {
  const row = isRecord(input) ? input : {}
  return {
    id: String(row.id ?? ""),
    team_id: String(row.team_id ?? row.teamId ?? ""),
    member_id: String(row.member_id ?? row.memberId ?? ""),
    is_lead: Boolean(row.is_lead ?? row.isLead),
    joined_at: row.joined_at != null ? String(row.joined_at) : undefined,
    assigned_by: row.assigned_by != null ? String(row.assigned_by) : undefined,
    updated_by: row.updated_by != null ? String(row.updated_by) : undefined,
    member_name:
      typeof row.member_name === "string"
        ? row.member_name
        : typeof row.memberName === "string"
          ? row.memberName
          : undefined,
    member_avatar:
      typeof row.member_avatar === "string"
        ? row.member_avatar
        : typeof row.memberAvatar === "string"
          ? row.memberAvatar
          : undefined,
    member_email:
      typeof row.member_email === "string"
        ? row.member_email
        : typeof row.memberEmail === "string"
          ? row.memberEmail
          : undefined,
    member_color:
      typeof row.member_color === "string"
        ? row.member_color
        : typeof row.memberColor === "string"
          ? row.memberColor
          : undefined,
    member_role:
      typeof row.member_role === "string"
        ? row.member_role
        : typeof row.memberRole === "string"
          ? row.memberRole
          : undefined,
  }
}

export interface TeamProject {
  id: string
  team_id: string
  project_id: string
  assigned_at?: string
  assigned_by?: string
  // Joined fields from projects
  project_name?: string
}

export interface CreateTeamPayload {
  name: string
  schedule_weekly_report?: boolean
  member_ids?: string[]
  lead_ids?: string[]
  project_ids?: string[]
}

export interface CreateTeamMemberPayload {
  team_id: string
  member_id: string
  is_lead?: boolean
}

export interface CreateTeamProjectPayload {
  team_id: string
  project_id: string
}

// Teams API
export async function getTeams(options: { fields?: string[] } = {}): Promise<Team[]> {
  const params = new URLSearchParams()
  const fields = options.fields ?? ["id", "name", "schedule_weekly_report", "created_at", "created_by", "updated_by"]
  if (fields.length) params.set("fields", fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(apiPath(`/api/teams${query}`))
  const json = await readJsonSafe<ApiEnvelope<Team[]>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to fetch teams", json)
  }
  return json.data
}

export async function createTeam(payload: CreateTeamPayload): Promise<Team> {
  const res = await apiFetch(apiPath("/api/teams"), { method: "POST", body: JSON.stringify(payload) }, { json: true })
  const json = await readJsonSafe<ApiEnvelope<Team>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to create team", json)
  }
  return json.data
}

export async function updateTeam(id: string, payload: Partial<CreateTeamPayload>): Promise<Team> {
  const res = await apiFetch(apiPath(`/api/teams/${id}`), { method: "PATCH", body: JSON.stringify(payload) }, { json: true })
  const json = await readJsonSafe<ApiEnvelope<Team>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to update team", json)
  }
  return json.data
}

export async function deleteTeam(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/teams/${id}`), { method: "DELETE" })
  const json = await readJsonSafe<ApiEnvelope<unknown>>(res)
  if (!res.ok) {
    throw extractApiError(res.status, "Failed to delete team", json)
  }
}

// Team Members API
export async function getTeamMembers(
  teamId?: string,
  options: { fields?: string[] } = {},
): Promise<TeamMember[]> {
  const params = new URLSearchParams()
  if (teamId) params.set("team_id", teamId)
  const fields = options.fields ?? [
    "id",
    "team_id",
    "member_id",
    "is_lead",
    "member_name",
    "member_avatar",
    "member_color",
    "member_role",
  ]
  if (fields.length) params.set("fields", fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(apiPath(`/api/team-members${query}`))
  const json = await readJsonSafe<ApiEnvelope<TeamMember[]>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to fetch team members", json)
  }
  return json.data.map((row) => normalizeTeamMember(row))
}

export async function addTeamMember(payload: CreateTeamMemberPayload): Promise<TeamMember> {
  const res = await apiFetch(apiPath("/api/team-members"), { method: "POST", body: JSON.stringify(payload) }, { json: true })
  const json = await readJsonSafe<ApiEnvelope<TeamMember>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to add team member", json)
  }
  return json.data
}

export async function updateTeamMember(
  id: string,
  payload: Partial<Pick<TeamMember, "is_lead">>,
): Promise<TeamMember> {
  const res = await apiFetch(apiPath(`/api/team-members/${id}`), { method: "PATCH", body: JSON.stringify(payload) }, { json: true })
  const json = await readJsonSafe<ApiEnvelope<TeamMember>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to update team member", json)
  }
  return json.data
}

export async function removeTeamMember(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/team-members/${id}`), { method: "DELETE" })
  const json = await readJsonSafe<ApiEnvelope<unknown>>(res)
  if (!res.ok) {
    throw extractApiError(res.status, "Failed to remove team member", json)
  }
}

// Team Projects API
export async function getTeamProjects(
  teamId?: string,
  options: { fields?: string[] } = {},
): Promise<TeamProject[]> {
  const params = new URLSearchParams()
  if (teamId) params.set("team_id", teamId)
  const fields = options.fields ?? ["id", "team_id", "project_id", "project_name"]
  if (fields.length) params.set("fields", fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(apiPath(`/api/team-projects${query}`))
  const json = await readJsonSafe<ApiEnvelope<TeamProject[]>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to fetch team projects", json)
  }
  return json.data
}

export async function addTeamProject(payload: CreateTeamProjectPayload): Promise<TeamProject> {
  const res = await apiFetch(apiPath("/api/team-projects"), { method: "POST", body: JSON.stringify(payload) }, { json: true })
  const json = await readJsonSafe<ApiEnvelope<TeamProject>>(res)
  if (!res.ok || !json?.data) {
    throw extractApiError(res.status, "Failed to add team project", json)
  }
  return json.data
}

export async function removeTeamProject(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/team-projects/${id}`), { method: "DELETE" })
  const json = await readJsonSafe<ApiEnvelope<unknown>>(res)
  if (!res.ok) {
    throw extractApiError(res.status, "Failed to remove team project", json)
  }
}
