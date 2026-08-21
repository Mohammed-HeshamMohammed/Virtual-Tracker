/* eslint-disable react-doctor/js-combine-iterations, react-doctor/async-await-in-loop, react-doctor/js-set-map-lookups */
import { extractApiError, apiFetch, fetchJsonWithRetry, type ApiEnvelope, type RequestOptions } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { resolveCurrentMemberId } from "@/features/members/services/current-member"
import { getClients } from "@/features/clients/api/client-api"
import { getProjectOverviewCore } from "@/features/projects/api/project-overview-api"
import { filterValidUuids, isValidUuid } from "@/shared/utils/uuid"
import {
  addProjectMember,
  createProject,
  getProjectMembers,
  getProjects,
  removeProjectMember,
  updateProject,
  type CreateProjectInput,
  type Project as ApiProject,
  type ProjectType,
} from "@/features/projects/api/project-api"


/** Payload mirroring the Desktop add-project form (all tabs). */
export interface CreateProjectFormPayload {
  name: string
  type: ProjectType
  billable: boolean
  disableActivity: boolean
  allowProjectTracking: boolean
  disableIdleTime: boolean
  /** Total idle-time threshold in seconds (hours+minutes in the UI, stored as
   * seconds on the wire) - how long without activity before time on this
   * project is marked idle. Defaults to 450 (7.5 minutes) on creation. */
  idleTimeSeconds: number
  /** Optional, informational only - see item 5 of the budget fixes plan. */
  endDate: string
  clientIds: string[]
  teamIds: string[]
  managerIds: string[]
  userIds: string[]
  viewerIds: string[]
  memberLimitMemberIds: string[]
  /** Whether timers stop once the budget cap is reached - not "does this
   * project have a budget" (every project always does, see item 6). */
  budgetStopTimers: boolean
  budgetType: string
  budgetBasedOn: string
  /** 'per_project' (flat total, the only prior behavior) or 'per_person'
   * (budgetTotal is hours-per-member; the real total scales with headcount). */
  budgetScope: string
  budgetTotal: string
  budgetResets: string
  budgetNotifyAt: string
  budgetWhoToNotify: string
  budgetStopTimersAt: string
  budgetStartDate: string
  budgetIncludeNonBillable: boolean
  budgetNotifyMembers: boolean
  memberLimitType: string
  memberLimitBasedOn: string
  memberLimitResets: string
  memberLimitStartDate: string
  memberLimitNotifyAt: string
  memberLimitNotifyMembers: boolean
  memberLimitMembers: string
  budgetSpent: number
}

export interface ProjectBudgetRow {
  id: string
  projectId: string
  type: string
  basedOn: string
  scope: string
  cost: number
  notifyProjectMembers: boolean
  notifyAtPct: number | null
  whoToNotify: string
  stopTimersWhenReached: boolean
  stopTimersAtPct: number | null
  resets: string
  startDate: string
  includeNonBillableTime: boolean
  /** Real value computed server-side from tracked time x rate - not stored, not
   * fabricated, and not something to send back on create/update (read-only). */
  spent?: number
  /** The real budget total to display: for scope='per_person' rows `cost` is
   * hours-per-member, not a total - this is `cost` scaled live by current
   * headcount (and rate, for Cost based). For scope='per_project' this just
   * equals `cost`. Read-only, never sent back on create/update. */
  target?: number
}

export interface ProjectMemberLimitRow {
  id: string
  projectId: string
  memberId: string | null
  type: string
  basedOn: string
  cost: number
  resets: string
  startDate: string
  notifyAtPct: number | null
  notifyProjectMembers: boolean
}

export interface TeamProjectLink {
  id: string
  teamId: string
  projectId: string
  teamName?: string
}

export interface ProjectMemberRow {
  id: string
  projectId: string
  memberId: string
  projectRole: string
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

async function resolveClientIdByName(name: string): Promise<string | undefined> {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  const clients = await getClients()
  const match = clients.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  return match?.id
}

async function resolveActorMemberId(_firebaseUid?: string, _email?: string): Promise<string | undefined> {
  return resolveCurrentMemberId()
}

async function linkClientToProject(clientId: string, projectId: string, assignedBy?: string): Promise<void> {
  const body: Record<string, unknown> = {
    client_id: clientId,
    project_id: projectId,
  }
  if (assignedBy && isValidUuid(assignedBy)) body.assigned_by = assignedBy
  const res = await apiFetch(apiPath("/api/client-projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw extractApiError(res.status, "Failed to link client to project", json)
  }
}

type ClientProjectLink = {
  id: string
  clientId: string
  projectId: string
}

async function getClientProjectLinksForProject(projectId: string): Promise<ClientProjectLink[]> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath(`/api/client-projects?project_id=${encodeURIComponent(projectId)}`),
    {},
    { retries: 1 },
  )
  if (!res.ok) return []
  return (json?.data ?? [])
    .map((row) => ({
      id: String(row.id ?? ""),
      clientId: String(row.client_id ?? row.clientId ?? ""),
      projectId: String(row.project_id ?? row.projectId ?? ""),
    }))
    .filter((row) => row.projectId === projectId)
}

async function deleteClientProjectLink(linkId: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/client-projects/${encodeURIComponent(linkId)}`), {
    method: "DELETE",
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw extractApiError(res.status, "Failed to remove client from project", json)
  }
}

async function syncClientLinks(
  projectId: string,
  clientIds: string[],
  actorMemberId?: string,
): Promise<void> {
  const desired = new Set(filterValidUuids(clientIds))
  const existing = await getClientProjectLinksForProject(projectId)

  // Derive "already linked" from the one fetch above instead of re-fetching
  // after the deletes - the set of links being kept is just existing minus
  // the ones about to be removed, no round-trip needed to know that.
  const toDelete = existing.filter((link) => !desired.has(link.clientId))
  const keptClientIds = new Set(
    existing.filter((link) => desired.has(link.clientId)).map((link) => link.clientId),
  )
  const toAdd = [...desired].filter((clientId) => !keptClientIds.has(clientId))

  await Promise.all([
    ...toDelete.map((link) => deleteClientProjectLink(link.id)),
    ...toAdd.map((clientId) => linkClientToProject(clientId, projectId, actorMemberId)),
  ])
}

async function getProjectBudgets(projectId?: string, options: RequestOptions & { fields?: string[] } = {}): Promise<ProjectBudgetRow[]> {
  const params = new URLSearchParams()
  if (projectId) params.append("project_id", projectId)
  if (options.fields?.length) params.append("fields", options.fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath(`/api/project-budgets${query}`),
    {},
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch project budgets", json)
  return (json?.data ?? []).map(mapBudgetRow)
}

async function updateProjectBudget(
  id: string,
  data: Partial<Omit<ProjectBudgetRow, "id" | "projectId">> & { updatedBy?: string; expectedUpdatedAt?: string },
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (data.type !== undefined) body.type = data.type
  if (data.basedOn !== undefined) body.based_on = data.basedOn
  if (data.scope !== undefined) body.scope = data.scope
  if (data.cost !== undefined) body.cost = data.cost
  if (data.notifyProjectMembers !== undefined) body.notify_project_members = data.notifyProjectMembers
  if (data.notifyAtPct !== undefined) body.notify_at_pct = data.notifyAtPct
  if (data.whoToNotify !== undefined) body.who_to_notify = data.whoToNotify
  if (data.stopTimersWhenReached !== undefined) body.stop_timers_when_reached = data.stopTimersWhenReached
  if (data.stopTimersAtPct !== undefined) body.stop_timers_at_pct = data.stopTimersAtPct
  if (data.resets !== undefined) body.resets = data.resets
  // null (not undefined) when cleared - JSON.stringify drops undefined keys
  // entirely, and the backend's `??` fallback-to-current can't tell "not
  // sent" from "sent empty" unless the key is actually present.
  if (data.startDate !== undefined) body.start_date = data.startDate || null
  if (data.includeNonBillableTime !== undefined) body.include_non_billable_time = data.includeNonBillableTime
  if (data.updatedBy && isValidUuid(data.updatedBy)) body.updated_by = data.updatedBy
  // §6.9 - optional, only present when the caller sends back the
  // budgetUpdatedAt it loaded the budget with.
  if (data.expectedUpdatedAt) body.expected_updated_at = data.expectedUpdatedAt
  const res = await apiFetch(apiPath(`/api/project-budgets/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!res.ok) {
    // §6.9 - same convention updateProject/updateTask use: attach .status
    // so the caller can branch on a stale-write conflict.
    const err = extractApiError(res.status, "Failed to update project budget", json) as Error & {
      status?: number
      conflictData?: unknown
    }
    err.status = res.status
    if (res.status === 409) err.conflictData = json?.data
    throw err
  }
  if (!json.success) throw new Error(json.error || "Failed to update project budget")
}

function mapBudgetRow(row: Record<string, unknown>): ProjectBudgetRow {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? row.projectId ?? ""),
    type: String(row.type ?? ""),
    basedOn: String(row.based_on ?? row.basedOn ?? ""),
    scope: row.scope === "per_person" ? "per_person" : "per_project",
    cost: Number(row.cost ?? 0),
    notifyProjectMembers: Boolean(row.notify_project_members ?? row.notifyProjectMembers),
    notifyAtPct:
      row.notify_at_pct != null
        ? Number(row.notify_at_pct)
        : row.notifyAtPct != null
          ? Number(row.notifyAtPct)
          : null,
    whoToNotify: String(row.who_to_notify ?? row.whoToNotify ?? ""),
    stopTimersWhenReached: Boolean(row.stop_timers_when_reached ?? row.stopTimersWhenReached),
    stopTimersAtPct:
      row.stop_timers_at_pct != null
        ? Number(row.stop_timers_at_pct)
        : row.stopTimersAtPct != null
          ? Number(row.stopTimersAtPct)
          : null,
    resets: String(row.resets ?? "Never"),
    startDate: String(row.start_date ?? row.startDate ?? ""),
    includeNonBillableTime: Boolean(row.include_non_billable_time ?? row.includeNonBillableTime ?? true),
    spent: Number(row.spent ?? 0),
    target: row.target != null ? Number(row.target) : Number(row.cost ?? 0),
  }
}

async function createProjectBudget(
  data: Omit<ProjectBudgetRow, "id"> & { createdBy?: string },
): Promise<ProjectBudgetRow> {
  const res = await apiFetch(apiPath("/api/project-budgets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: data.projectId,
      type: data.type,
      based_on: data.basedOn,
      scope: data.scope,
      cost: data.cost,
      notify_project_members: data.notifyProjectMembers,
      notify_at_pct: data.notifyAtPct,
      who_to_notify: data.whoToNotify,
      stop_timers_when_reached: data.stopTimersWhenReached,
      stop_timers_at_pct: data.stopTimersAtPct,
      resets: data.resets,
      start_date: data.startDate || undefined,
      include_non_billable_time: data.includeNonBillableTime,
      ...(data.createdBy && isValidUuid(data.createdBy) ? { created_by: data.createdBy } : {}),
    }),
  })
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>>
  if (!res.ok) throw extractApiError(res.status, "Failed to create project budget", json)
  if (!json.success) throw new Error(json.error || "Failed to create project budget")
  // The POST response already IS the created row - no need for the follow-up
  // GET /api/project-budgets this used to do just to hand back a value the
  // create path never even read.
  return mapBudgetRow(json.data ?? {})
}

async function getProjectMemberLimits(projectId?: string, options: RequestOptions & { fields?: string[] } = {}): Promise<ProjectMemberLimitRow[]> {
  const params = new URLSearchParams()
  if (projectId) params.append("project_id", projectId)
  if (options.fields?.length) params.append("fields", options.fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath(`/api/project-member-limits${query}`),
    {},
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch project member limits", json)
  return (json?.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? row.projectId ?? ""),
    memberId: row.member_id != null ? String(row.member_id) : row.memberId != null ? String(row.memberId) : null,
    type: String(row.type ?? ""),
    basedOn: String(row.based_on ?? row.basedOn ?? ""),
    cost: Number(row.cost ?? 0),
    resets: String(row.resets ?? "Never"),
    startDate: String(row.start_date ?? row.startDate ?? ""),
    notifyAtPct:
      row.notify_at_pct != null
        ? Number(row.notify_at_pct)
        : row.notifyAtPct != null
          ? Number(row.notifyAtPct)
          : null,
    notifyProjectMembers: Boolean(row.notify_project_members ?? row.notifyProjectMembers),
  }))
}

async function createProjectMemberLimit(
  data: Omit<ProjectMemberLimitRow, "id"> & { createdBy?: string },
): Promise<void> {
  const res = await apiFetch(apiPath("/api/project-member-limits"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: data.projectId,
      member_id: data.memberId || undefined,
      type: data.type,
      based_on: data.basedOn,
      cost: data.cost,
      resets: data.resets,
      start_date: data.startDate || undefined,
      notify_at_pct: data.notifyAtPct,
      notify_project_members: data.notifyProjectMembers,
      ...(data.createdBy && isValidUuid(data.createdBy) ? { created_by: data.createdBy } : {}),
    }),
  })
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!res.ok) throw extractApiError(res.status, "Failed to create project member limit", json)
  if (!json.success) throw new Error(json.error || "Failed to create project member limit")
}

async function getTeamProjectLinks(): Promise<TeamProjectLink[]> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath("/api/projects/team-links"),
    {},
    { retries: 1 },
  )
  if (!res.ok) return []
  return (json?.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    teamId: String(row.team_id ?? row.teamId ?? ""),
    projectId: String(row.project_id ?? row.projectId ?? ""),
    teamName: row.team_name != null ? String(row.team_name) : undefined,
  }))
}

export async function getTeamProjectLinksForProject(projectId: string): Promise<TeamProjectLink[]> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath(`/api/team-projects?project_id=${encodeURIComponent(projectId)}`),
    {},
    { retries: 1 },
  )
  if (!res.ok) return []
// eslint-disable-next-line react-doctor/js-flatmap-filter
  return (json?.data ?? [])
    .map((row) => ({
      id: String(row.id ?? ""),
      teamId: String(row.team_id ?? row.teamId ?? ""),
      projectId: String(row.project_id ?? row.projectId ?? ""),
    }))
    .filter((row) => row.projectId === projectId)
}

async function deleteTeamProjectLink(linkId: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/team-projects/${encodeURIComponent(linkId)}`), {
    method: "DELETE",
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw extractApiError(res.status, "Failed to remove team from project", json)
  }
}

async function getProjectMemberRows(options: RequestOptions & { fields?: string[] } = {}): Promise<ProjectMemberRow[]> {
  const params = new URLSearchParams()
  if (options.fields?.length) params.append("fields", options.fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Record<string, unknown>[]>>(
    apiPath(`/api/project-members${query}`),
    {},
    { ...options, retries: 1 },
  )
  if (!res.ok) return []
  return (json?.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? row.projectId ?? ""),
    memberId: String(row.member_id ?? row.memberId ?? ""),
    projectRole: String(row.project_role ?? row.projectRole ?? ""),
  }))
}

export type CreateProjectActor = {
  firebaseUid?: string
  email?: string
  memberId?: string
}

export type ProjectEditLoadedState = CreateProjectFormPayload & {
  budgetId?: string
  /** Optimistic-concurrency token (§6.9) - sent back unchanged on save. */
  updatedAt?: string
  /** Same, for the budget row specifically - it saves through its own PATCH. */
  budgetUpdatedAt?: string
}

function normalizeProjectRole(role: string): string {
  const value = role.trim().toLowerCase()
  if (value === "managers" || value === "manager") return "manager"
  if (value === "users" || value === "user") return "user"
  if (value === "viewers" || value === "viewer") return "viewer"
  if (value === "members" || value === "member") return "member"
  return value || "member"
}

function ensureActorInMembers(
  payload: CreateProjectFormPayload,
  actorMemberId?: string,
): CreateProjectFormPayload {
  if (!actorMemberId || !isValidUuid(actorMemberId)) return payload
  const actor = actorMemberId.trim()
  const alreadyAssigned =
    payload.managerIds.some((id) => id.trim() === actor) ||
    payload.userIds.some((id) => id.trim() === actor) ||
    payload.viewerIds.some((id) => id.trim() === actor)
  if (alreadyAssigned) return payload
  return { ...payload, managerIds: [...payload.managerIds, actor] }
}

function shouldPersistBudget(payload: CreateProjectFormPayload): boolean {
  const hasType = Boolean(payload.budgetType.trim())
  if (!hasType) return false
  if (payload.budgetType === "Hours based") return true
  return Boolean(payload.budgetBasedOn.trim())
}

function buildBudgetFields(payload: CreateProjectFormPayload) {
  return {
    type: payload.budgetType,
    basedOn: payload.budgetBasedOn,
    scope: payload.budgetScope === "per_person" ? "per_person" : "per_project",
    cost: parseOptionalNumber(payload.budgetTotal) ?? 0,
    notifyProjectMembers: payload.budgetNotifyMembers,
    // Dependent fields are already cleared to "" by the modal when their
    // owning switch is toggled off (see project-modal.tsx), so an empty
    // string here already means "send null" via parseOptionalNumber - no
    // second gate needed on this side.
    notifyAtPct: parseOptionalNumber(payload.budgetNotifyAt),
    whoToNotify: payload.budgetWhoToNotify,
    stopTimersWhenReached: payload.budgetStopTimers,
    stopTimersAtPct: parseOptionalNumber(payload.budgetStopTimersAt),
    resets: payload.budgetResets || "Never",
    startDate: payload.budgetStartDate,
    includeNonBillableTime: payload.budgetIncludeNonBillable,
  }
}

/** Loads project + relations into the add/edit project form shape. */
export async function fetchProjectForEdit(projectId: string): Promise<ProjectEditLoadedState> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<ProjectEditLoadedState>>(
    apiPath(`/api/projects/${encodeURIComponent(projectId)}/edit-state`),
    {},
    { retries: 1 },
  )
  if (!res.ok) {
    const err = extractApiError(res.status, "Failed to load project for edit", json) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load project for edit")
  const data = json.data
  const legacyClientId = (data as ProjectEditLoadedState & { clientId?: string }).clientId
  const rawClientIds = Array.isArray(data.clientIds)
    ? data.clientIds
    : legacyClientId
      ? [legacyClientId]
      : []
  return {
    ...data,
    type: data.type === "calling" ? "calling" : "normal",
    clientIds: filterValidUuids(rawClientIds.map((id) => String(id))),
    teamIds: (data.teamIds ?? []).filter((id) => id.trim().length > 0),
    managerIds: data.managerIds ?? [],
    userIds: data.userIds ?? [],
    viewerIds: data.viewerIds ?? [],
    memberLimitMemberIds: data.memberLimitMemberIds ?? [],
  }
}

async function syncTeamLinks(
  projectId: string,
  teamIds: string[],
  actorMemberId?: string,
): Promise<void> {
  const desired = new Set(
    teamIds.map((id) => id.trim()).filter((id) => id.length > 0 && isValidUuid(id)),
  )
  const existing = await getTeamProjectLinksForProject(projectId)

  // Same one-fetch diff as syncClientLinks - no need to re-fetch after
  // deleting to know what's left, it's derivable from `existing`.
  const toDelete = existing.filter((link) => !desired.has(link.teamId))
  const keptTeamIds = new Set(
    existing.filter((link) => desired.has(link.teamId)).map((link) => link.teamId),
  )
  const toAdd = [...desired].filter((teamId) => !keptTeamIds.has(teamId))

  await Promise.all([
    ...toDelete.map((link) => deleteTeamProjectLink(link.id)),
    linkTeamsFast(projectId, toAdd, actorMemberId),
  ])
}

async function syncProjectMembers(
  projectId: string,
  payload: CreateProjectFormPayload,
  actorMemberId?: string,
): Promise<void> {
  const desired: { memberId: string; role: string }[] = [
    ...payload.managerIds.map((memberId) => ({ memberId: memberId.trim(), role: "manager" })),
    ...payload.userIds.map((memberId) => ({ memberId: memberId.trim(), role: "user" })),
    ...payload.viewerIds.map((memberId) => ({ memberId: memberId.trim(), role: "viewer" })),
  ].filter((link) => link.memberId.length > 0)

  const desiredKeys = new Set(desired.map((d) => `${d.memberId}:${d.role}`))
  const existing = await getProjectMembers(projectId)

  const toRemove = existing.filter((row) => {
    const role = normalizeProjectRole(row.projectRole)
    if (role === "member") return true
    return !desiredKeys.has(`${row.memberId}:${role}`)
  })

  const existingKeys = new Set(
    existing.map((r) => `${r.memberId}:${normalizeProjectRole(r.projectRole)}`),
  )
  const seen = new Set<string>()
  const toAdd = desired.filter((link) => {
    const key = `${link.memberId}:${link.role}`
    if (seen.has(key) || existingKeys.has(key)) return false
    seen.add(key)
    return isValidUuid(link.memberId)
  })

  await Promise.all([
    ...toRemove.map((row) => removeProjectMember(row.id)),
    ...toAdd.map((link) => addProjectMember(projectId, link.memberId, link.role, actorMemberId)),
  ])
}

// ---------------------------------------------------------------------------
// Create-only fast paths (item 3 of the budget fixes plan)
//
// syncClientLinks / syncProjectMembers / syncTeamLinks above exist to diff
// against links that might already exist - correct for editing a project,
// pure overhead for a project created milliseconds ago that has none. Each
// of these skips the read-then-diff and just posts what's desired, so the
// create flow trades ~13 sequential round-trips for a handful of ones that
// all run in parallel (see createProjectWithDetails below). The edit path
// keeps using the sync* functions unchanged.
// ---------------------------------------------------------------------------

async function linkClientsFast(
  projectId: string,
  clientIds: string[],
  actorMemberId?: string,
): Promise<void> {
  const desired = filterValidUuids(clientIds)
  await Promise.all(desired.map((clientId) => linkClientToProject(clientId, projectId, actorMemberId)))
}

async function linkTeamsFast(
  projectId: string,
  teamIds: string[],
  actorMemberId?: string,
): Promise<void> {
  const desired = [...new Set(teamIds.map((id) => id.trim()).filter((id) => isValidUuid(id)))]
  await Promise.all(
    desired.map((teamId) => {
      const body: Record<string, unknown> = { team_id: teamId, project_id: projectId }
      if (actorMemberId && isValidUuid(actorMemberId)) body.assigned_by = actorMemberId
      return apiFetch(apiPath("/api/team-projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => null)
          throw extractApiError(res.status, "Failed to link team to project", json)
        }
      })
    }),
  )
}

async function addProjectMembersFast(
  projectId: string,
  payload: CreateProjectFormPayload,
  actorMemberId?: string,
): Promise<void> {
  const raw: { memberId: string; role: string }[] = [
    ...payload.managerIds.map((memberId) => ({ memberId: memberId.trim(), role: "manager" })),
    ...payload.userIds.map((memberId) => ({ memberId: memberId.trim(), role: "user" })),
    ...payload.viewerIds.map((memberId) => ({ memberId: memberId.trim(), role: "viewer" })),
  ].filter((link) => isValidUuid(link.memberId))
  const seen = new Set<string>()
  const desired = raw.filter((link) => {
    const key = `${link.memberId}:${link.role}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  await Promise.all(desired.map((link) => addProjectMember(projectId, link.memberId, link.role, actorMemberId)))
}

async function createProjectMemberLimitsFast(
  projectId: string,
  payload: CreateProjectFormPayload,
  actorMemberId?: string,
): Promise<void> {
  if (
    payload.memberLimitMemberIds.length === 0 ||
    !payload.memberLimitType.trim() ||
    !payload.memberLimitBasedOn.trim()
  ) {
    return
  }
  const limitCost = parseOptionalNumber(String(payload.budgetSpent)) ?? 0
  await Promise.all(
    filterValidUuids(payload.memberLimitMemberIds).map((memberId) =>
      createProjectMemberLimit({
        projectId,
        memberId,
        type: payload.memberLimitType,
        basedOn: payload.memberLimitBasedOn,
        cost: limitCost,
        resets: payload.memberLimitResets || "Never",
        startDate: payload.memberLimitStartDate,
        notifyAtPct: parseOptionalNumber(payload.memberLimitNotifyAt),
        notifyProjectMembers: payload.memberLimitNotifyMembers,
        ...(actorMemberId ? { createdBy: actorMemberId } : {}),
      }).catch((err) => {
        console.warn("project-member-limits failed", err)
      }),
    ),
  )
}

/** Updates project + budget, member links, and team links. */
export async function updateProjectWithDetails(
  projectId: string,
  payload: CreateProjectFormPayload,
  actor?: CreateProjectActor,
  options?: { budgetId?: string; expectedUpdatedAt?: string; expectedBudgetUpdatedAt?: string },
): Promise<ApiProject> {
  const actorMemberId =
    (actor?.memberId && isValidUuid(actor.memberId) ? actor.memberId : undefined) ??
    (await resolveActorMemberId(actor?.firebaseUid, actor?.email))

  const clientIds = filterValidUuids(payload.clientIds)
  const primaryClientId = clientIds[0]
  const memberPayload = ensureActorInMembers(payload, actorMemberId)

  // projectId already exists (this is the edit path), so - same as
  // createProjectWithDetails below - the core field update and every link/
  // budget sync are independent of each other and run concurrently instead
  // of as a 4+ round-trip serial chain.
  const [updated] = await Promise.all([
    updateProject(projectId, {
      name: payload.name,
      billable: payload.billable,
      disableActivity: payload.disableActivity,
      allowProjectTracking: payload.allowProjectTracking,
      disableIdleTime: payload.disableIdleTime,
      idleTimeSeconds: payload.idleTimeSeconds,
      endDate: payload.endDate,
      clientId: primaryClientId || "",
      ...(actorMemberId ? { updatedBy: actorMemberId } : {}),
      ...(options?.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
    }),
    syncClientLinks(projectId, clientIds, actorMemberId),
    syncProjectMembers(projectId, memberPayload, actorMemberId),
    syncTeamLinks(projectId, payload.teamIds, actorMemberId),
    shouldPersistBudget(payload)
      ? persistBudgetForProject(projectId, payload, actorMemberId, options?.budgetId, options?.expectedBudgetUpdatedAt)
      : Promise.resolve(),
  ])

  return updated
}

async function persistBudgetForProject(
  projectId: string,
  payload: CreateProjectFormPayload,
  actorMemberId: string | undefined,
  budgetId: string | undefined,
  expectedBudgetUpdatedAt?: string,
): Promise<void> {
  const budgetData = buildBudgetFields(payload)
  if (budgetId) {
    await updateProjectBudget(budgetId, {
      ...budgetData,
      ...(actorMemberId ? { updatedBy: actorMemberId } : {}),
      ...(expectedBudgetUpdatedAt ? { expectedUpdatedAt: expectedBudgetUpdatedAt } : {}),
    })
  } else {
    await createProjectBudget({
      projectId,
      ...budgetData,
      ...(actorMemberId ? { createdBy: actorMemberId } : {}),
    })
  }
}

/** Creates project + budget, member limit, team links, and optional client link. */
export async function createProjectWithDetails(
  payload: CreateProjectFormPayload,
  actor?: CreateProjectActor,
): Promise<ApiProject> {
  const actorMemberId =
    (actor?.memberId && isValidUuid(actor.memberId) ? actor.memberId : undefined) ??
    (await resolveActorMemberId(actor?.firebaseUid, actor?.email))

  const clientIds = filterValidUuids(payload.clientIds)
  const primaryClientId = clientIds[0]

  const projectInput: CreateProjectInput = {
    name: payload.name,
    type: payload.type,
    status: "active",
    billable: payload.billable,
    disableActivity: payload.disableActivity,
    allowProjectTracking: payload.allowProjectTracking,
    disableIdleTime: payload.disableIdleTime,
    idleTimeSeconds: payload.idleTimeSeconds,
    endDate: payload.endDate,
    clientId: primaryClientId,
    ...(actorMemberId ? { createdBy: actorMemberId } : {}),
  }

  const created = await createProject(projectInput)

  // Every one of these is independent once the project id exists - no
  // ordering dependency between budget, client links, member links, team
  // links, and member limits, so they run concurrently instead of as a
  // 13-round-trip serial chain (item 3 of the budget fixes plan).
  const memberPayload = ensureActorInMembers(payload, actorMemberId)
  await Promise.all([
    shouldPersistBudget(payload)
      ? createProjectBudget({
          projectId: created.id,
          ...buildBudgetFields(payload),
          ...(actorMemberId ? { createdBy: actorMemberId } : {}),
        })
      : Promise.resolve(),
    linkClientsFast(created.id, clientIds, actorMemberId),
    addProjectMembersFast(created.id, memberPayload, actorMemberId),
    linkTeamsFast(created.id, payload.teamIds, actorMemberId),
    createProjectMemberLimitsFast(created.id, payload, actorMemberId),
  ])

  return created
}

export interface EnrichedProjectListContext {
  budgetsByProject: Map<string, ProjectBudgetRow>
  memberCountByProject: Map<string, number>
  memberLimitByProject: Map<string, number>
  teamNamesByProject: Map<string, string[]>
  memberIdsByProject: Map<string, string[]>
  taskCountsByProject: Map<string, { done: number; total: number }>
}

async function loadProjectListContext(): Promise<EnrichedProjectListContext> {
  const [budgets, members, teamLinks, limits, overview] = await Promise.all([
    getProjectBudgets(undefined, { fields: ["id", "project_id", "cost", "type", "based_on"] }).catch(() => [] as ProjectBudgetRow[]),
    getProjectMemberRows({ fields: ["id", "project_id", "member_id"] }).catch(() => [] as ProjectMemberRow[]),
    getTeamProjectLinks().catch(() => [] as TeamProjectLink[]),
    getProjectMemberLimits(undefined, { fields: ["id", "project_id", "cost"] }).catch(() => [] as ProjectMemberLimitRow[]),
    // Task counts come from the overview endpoint's SQL aggregate rather than
    // pulling every task row down to count client-side.
    getProjectOverviewCore().catch(() => null),
  ])

  const budgetsByProject = new Map<string, ProjectBudgetRow>()
  for (const b of budgets) {
    if (!budgetsByProject.has(b.projectId)) budgetsByProject.set(b.projectId, b)
  }

  const memberCountByProject = new Map<string, number>()
  const memberIdsByProject = new Map<string, string[]>()
  for (const m of members) {
    memberCountByProject.set(m.projectId, (memberCountByProject.get(m.projectId) ?? 0) + 1)
    const ids = memberIdsByProject.get(m.projectId) ?? []
    ids.push(m.memberId)
    memberIdsByProject.set(m.projectId, ids)
  }

  const teamNamesByProject = new Map<string, string[]>()
  for (const link of teamLinks) {
    const name = link.teamName?.trim() || link.teamId
    const list = teamNamesByProject.get(link.projectId) ?? []
    if (!list.includes(name)) list.push(name)
    teamNamesByProject.set(link.projectId, list)
  }

  const memberLimitByProject = new Map<string, number>()
  for (const limit of limits) {
    if (limit.cost > 0) memberLimitByProject.set(limit.projectId, limit.cost)
  }

  const taskCountsByProject = new Map<string, { done: number; total: number }>()
  for (const row of overview?.projects ?? []) {
    taskCountsByProject.set(row.id, { done: row.p?.d ?? 0, total: row.p?.t ?? 0 })
  }

  return {
    budgetsByProject,
    memberCountByProject,
    memberLimitByProject,
    teamNamesByProject,
    memberIdsByProject,
    taskCountsByProject,
  }
}

export async function fetchEnrichedProjects(): Promise<{
  projects: ApiProject[]
  context: EnrichedProjectListContext
}> {
  const [projects, context] = await Promise.all([
    getProjects({ fields: ["id", "name", "status", "type"] }),
    loadProjectListContext(),
  ])
  return { projects, context }
}
