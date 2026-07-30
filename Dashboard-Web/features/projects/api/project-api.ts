import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, apiFetch, fetchJsonWithRetry, type RequestOptions } from "@/infrastructure/api/http"
import { isValidUuid } from "@/shared/utils/uuid"

type Envelope<T> = { success?: boolean; error?: string; data?: T }

function toProject(input: Record<string, unknown>): Project {
  return {
    id: String(input.id ?? ""),
    name: String(input.name ?? ""),
    type: (String(input.type ?? "normal").toLowerCase() as ProjectType) || "normal",
    clientId: String(input.clientId ?? input.client_id ?? ""),
    status: (String(input.status ?? "active").toLowerCase() as Project["status"]) || "active",
    billable: Boolean(input.billable),
    disableActivity: Boolean(input.disable_activity ?? input.disableActivity),
    allowProjectTracking: Boolean(
      input.allow_project_tracking ?? input.allowProjectTracking ?? true,
    ),
    disableIdleTime: Boolean(input.disable_idle_time ?? input.disableIdleTime),
    endDate: String(input.end_date ?? input.endDate ?? ""),
    managersNotes: String(input.managers_notes ?? input.managersNotes ?? ""),
    usersNotes: String(input.users_notes ?? input.usersNotes ?? ""),
    viewersNotes: String(input.viewers_notes ?? input.viewersNotes ?? ""),
    createdAt: String(input.createdAt ?? input.created_at ?? ""),
    createdBy: String(input.createdBy ?? input.created_by ?? ""),
    updatedBy: String(input.updatedBy ?? input.updated_by ?? ""),
    updatedAt: String(input.updatedAt ?? input.updated_at ?? ""),
    archivedBy: String(input.archivedBy ?? input.archived_by ?? ""),
    archivedAt: String(input.archivedAt ?? input.archived_at ?? ""),
  }
}

function toProjectPayload(
  input: CreateProjectInput | UpdateProjectInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ("name" in input && input.name !== undefined) out.name = input.name
  if ((input as CreateProjectInput).type !== undefined) out.type = (input as CreateProjectInput).type
  if (input.status !== undefined) out.status = input.status
  if (input.billable !== undefined) out.billable = input.billable
  if (input.disableActivity !== undefined) out.disable_activity = input.disableActivity
  if (input.allowProjectTracking !== undefined) out.allow_project_tracking = input.allowProjectTracking
  if (input.disableIdleTime !== undefined) out.disable_idle_time = input.disableIdleTime
  if (input.endDate !== undefined) out.end_date = input.endDate || undefined
  if (input.clientId !== undefined) out.client_id = input.clientId || null
  if (input.managersNotes !== undefined) out.managers_notes = input.managersNotes
  if (input.usersNotes !== undefined) out.users_notes = input.usersNotes
  if (input.viewersNotes !== undefined) out.viewers_notes = input.viewersNotes
  if ((input as CreateProjectInput).createdBy !== undefined) {
    out.created_by = (input as CreateProjectInput).createdBy
  }
  if ((input as UpdateProjectInput).updatedBy !== undefined) {
    out.updated_by = (input as UpdateProjectInput).updatedBy
  }
  if ((input as UpdateProjectInput).archivedBy !== undefined) {
    out.archived_by = (input as UpdateProjectInput).archivedBy
  }
  if ((input as UpdateProjectInput).archivedAt !== undefined) {
    out.archived_at = (input as UpdateProjectInput).archivedAt
  }
  return out
}

/**
 * "calling" projects track time straight against the project with no task -
 * tasks are what performance is calculated from, and calling work has none.
 * Set at creation only; the backend rejects changing it afterwards.
 */
export type ProjectType = "normal" | "calling"

export interface Project {
  id: string
  name: string
  type: ProjectType
  clientId: string
  status: "active" | "archived" | "completed"
  billable: boolean
  disableActivity: boolean
  allowProjectTracking: boolean
  disableIdleTime: boolean
  endDate: string
  managersNotes: string
  usersNotes: string
  viewersNotes: string
  createdAt: string
  createdBy: string
  updatedBy: string
  updatedAt: string
  archivedBy: string
  archivedAt: string
}

export interface ProjectMember {
  id: string
  projectId: string
  memberId: string
  projectRole: string
  assignedAt: string
  assignedBy: string
}

export interface CreateProjectInput {
  name: string
  type?: ProjectType
  status?: string
  billable?: boolean
  disableActivity?: boolean
  allowProjectTracking?: boolean
  disableIdleTime?: boolean
  endDate?: string
  clientId?: string
  managersNotes?: string
  usersNotes?: string
  viewersNotes?: string
  createdBy?: string
}

export interface UpdateProjectInput {
  name?: string
  status?: string
  billable?: boolean
  disableActivity?: boolean
  allowProjectTracking?: boolean
  disableIdleTime?: boolean
  endDate?: string
  clientId?: string
  managersNotes?: string
  usersNotes?: string
  viewersNotes?: string
  updatedBy?: string
  archivedBy?: string
  archivedAt?: string | null
}

export async function getProjects(options: RequestOptions & { fields?: string[] } = {}): Promise<Project[]> {
  const params = new URLSearchParams()
  const fields = options.fields ?? ["id", "name", "type", "clientId", "client_id", "status", "billable", "disableActivity", "disable_activity", "allowProjectTracking", "allow_project_tracking", "disableIdleTime", "disable_idle_time", "endDate", "end_date", "managersNotes", "managers_notes", "usersNotes", "users_notes", "viewersNotes", "viewers_notes", "createdAt", "created_at", "createdBy", "created_by", "updatedBy", "updated_by", "updatedAt", "updated_at", "archivedBy", "archived_by", "archivedAt", "archived_at"]
  if (fields.length) params.set("fields", fields.join(","))

  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>[]>>(
    apiPath(`/api/projects${query}`),
    {},
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch projects", json)
  if (!json?.success) throw new Error(json?.error || "Failed to fetch projects")
  return (json.data ?? []).map((row) => toProject(row))
}

async function getProject(id: string): Promise<Project> {
  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>>>(
    apiPath(`/api/projects/${id}`),
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch project", json)
  if (!json?.success) throw new Error(json?.error || "Failed to fetch project")
  return toProject(json.data ?? {})
}

export async function createProject(data: CreateProjectInput): Promise<Project> {
  const res = await apiFetch(apiPath("/api/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toProjectPayload(data)),
  })
  const json = (await res.json()) as Envelope<Record<string, unknown>>
  if (!res.ok) throw extractApiError(res.status, "Failed to create project", json)
  if (!json.success) throw new Error(json.error || "Failed to create project")
  return toProject(json.data ?? {})
}

export async function updateProject(id: string, data: UpdateProjectInput): Promise<Project> {
  const res = await apiFetch(apiPath(`/api/projects/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toProjectPayload(data)),
  })
  const json = (await res.json()) as Envelope<Record<string, unknown>>
  if (!res.ok) throw extractApiError(res.status, "Failed to update project", json)
  if (!json.success) throw new Error(json.error || "Failed to update project")
  return toProject(json.data ?? {})
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/projects/${id}`), { method: "DELETE" })
  if (res.status === 404) return
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw extractApiError(res.status, "Failed to delete project", json)
  }
}

export async function archiveProject(
  id: string,
  archive: boolean,
  userId?: string,
): Promise<Project> {
  if (archive) {
    return updateProject(id, {
      status: "archived",
      archivedBy: userId,
      archivedAt: new Date().toISOString(),
      updatedBy: userId,
    })
  }
  return updateProject(id, {
    status: "active",
    archivedBy: undefined,
    archivedAt: null,
    updatedBy: userId,
  })
}

export async function getProjectMembers(
  projectId?: string,
  options: RequestOptions & { fields?: string[] } = {},
): Promise<ProjectMember[]> {
  const params = new URLSearchParams()
  if (projectId) params.append("project_id", projectId)
  if (options.fields?.length) params.append("fields", options.fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""

  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>[]>>(
    apiPath(`/api/project-members${query}`),
    {},
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch project members", json)
  if (!json?.success) throw new Error(json?.error || "Failed to fetch project members")
  const rows = (json.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? row.projectId ?? ""),
    memberId: String(row.member_id ?? row.memberId ?? ""),
    projectRole: String(row.project_role ?? row.projectRole ?? ""),
    assignedAt: String(row.assigned_at ?? row.assignedAt ?? ""),
    assignedBy: String(row.assigned_by ?? row.assignedBy ?? ""),
  }))
  if (!projectId) return rows
  return rows.filter((row) => row.projectId === projectId)
}

export async function addProjectMember(
  projectId: string,
  memberId: string,
  projectRole: string,
  assignedBy?: string,
): Promise<ProjectMember> {
  const body: Record<string, unknown> = {
    project_id: projectId,
    member_id: memberId,
    project_role: projectRole,
  }
  if (assignedBy && isValidUuid(assignedBy)) body.assigned_by = assignedBy
  const res = await apiFetch(apiPath("/api/project-members"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as Envelope<Record<string, unknown>>
  if (!res.ok) throw extractApiError(res.status, "Failed to add project member", json)
  if (!json.success) throw new Error(json.error || "Failed to add project member")
  const row = json.data ?? {}
  return {
    id: String(row.id ?? ""),
    projectId,
    memberId,
    projectRole,
    assignedAt: String(row.assigned_at ?? ""),
    assignedBy: String(row.assigned_by ?? assignedBy ?? ""),
  }
}

export async function removeProjectMember(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/project-members/${id}`), { method: "DELETE" })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw extractApiError(res.status, "Failed to remove project member", json)
  }
}
