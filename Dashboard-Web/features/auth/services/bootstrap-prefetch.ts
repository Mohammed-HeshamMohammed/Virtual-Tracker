import { BOOTSTRAP_WARM_TTL_MS } from "@/infrastructure/config/firestore-throttle"
import { extractRoleFromRecord } from "@/features/auth/permissions/member-role-access"
import { fetchBootstrapWarmBundle, type BootstrapWarmPayload } from "@/features/auth/services/bootstrap-warm"
import { coalesceRequest } from "@/infrastructure/api/request-coalesce"
import { getMembers, getInvites } from "@/features/members/api/member-api"
import { fetchEnrichedProjects } from "@/features/projects/api/project-details-api"
import type { Member } from "@/features/members/models/member"
import {
  touchFetchTime,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"
import {
  membersListCacheKey,
  membersListFieldSignature,
  resolveDefaultMembersListFields,
} from "@/features/members/utils/resolve-members-list-fields"
import { fetchEnrichedTeams } from "@/features/teams/services/enrich-teams"
import {
  buildProjectsListForTasks,
  fetchTasksList,
} from "@/features/tasks/api/api-helpers"

export type BootstrapProgress = {
  message: string
  step: number
  totalSteps: number
  percent: number
}

type WarmCoreDataOptions = {
  onProgress?: (progress: BootstrapProgress) => void
  currentMember?: Member | null
}

const TOTAL_STEPS = 3
const WARM_SESSION_KEY = "vt-bootstrap-warm-at"
const PROJECT_COLOR_POOL = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]

function report(
  onProgress: WarmCoreDataOptions["onProgress"],
  step: number,
  message: string,
): void {
  onProgress?.({
    message,
    step,
    totalSteps: TOTAL_STEPS,
    percent: Math.round((step / TOTAL_STEPS) * 100),
  })
}

function seedNamespace(namespace: string, entries: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(entries)) {
    writeCache(`${namespace}:${key}`, value)
  }
  touchFetchTime(`${namespace}:__meta__`)
}

function seedMembersListCache(members: Member[]): void {
  const fields = resolveDefaultMembersListFields()
  writeCache(membersListCacheKey(fields), members)
  writeCache("people-members:__members_meta__", { fieldSignature: membersListFieldSignature(fields) })
  touchFetchTime("people-members:__members_meta__")
}

function mapWarmMember(row: Record<string, unknown>): Member {
  const first = typeof row.first_name === "string" ? row.first_name : ""
  const last = typeof row.last_name === "string" ? row.last_name : ""
  // Same order as normalizeMember and the server's memberMetaFromRow:
  // display_name is the column that actually holds a full name for members
  // created through an invite or renamed in profile settings.
  const display = typeof row.display_name === "string" ? row.display_name : ""
  const name =
    (typeof row.name === "string" && row.name.trim()) ||
    display.trim() ||
    [first, last].filter(Boolean).join(" ").trim() ||
    "Member"
  const email = typeof row.work_email === "string" ? row.work_email : ""
  const role = extractRoleFromRecord(row)
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "??"
  return {
    id: String(row.id ?? ""),
    memberUid: String(row.id ?? ""),
    firebaseUid: typeof row.firebase_uid === "string" ? row.firebase_uid : undefined,
    name,
    email,
    avatar: initials,
    avatarColor: typeof row.avatar_color === "string" ? row.avatar_color : "#3b82f6",
    status: (typeof row.status === "string" ? row.status : "active") as Member["status"],
    role: role as Member["role"],
    role_name: role,
    projects: 0,
    payment: "$0/hr",
    limits: "No limit",
    trackingStatus: "offline",
    dateAdded: "",
    teams: 0,
    teamNames: [],
    createdBy: "",
    createdByUid: "",
    personalEmail: "",
    phone: "",
    avatarUrl: "",
    lastIp: "",
    weeklyLimit: "",
  }
}

function buildProjectListContext(warm: BootstrapWarmPayload) {
  const budgetsByProject = new Map<string, { cost: number }>()
  for (const row of warm.projectBudgets) {
    const projectId = String(row.project_id ?? row.projectId ?? "")
    if (!projectId || budgetsByProject.has(projectId)) continue
    budgetsByProject.set(projectId, { cost: Number(row.cost ?? 0) })
  }

  const memberCountByProject = new Map<string, number>()
  const memberIdsByProject = new Map<string, string[]>()
  for (const row of warm.projectMembers) {
    const projectId = String(row.project_id ?? row.projectId ?? "")
    const memberId = String(row.member_id ?? row.memberId ?? "")
    if (!projectId || !memberId) continue
    memberCountByProject.set(projectId, (memberCountByProject.get(projectId) ?? 0) + 1)
    const ids = memberIdsByProject.get(projectId) ?? []
    ids.push(memberId)
    memberIdsByProject.set(projectId, ids)
  }

  const teamNamesByProject = new Map<string, string[]>()
  for (const link of warm.teamProjectLinks) {
    const projectId = String(link.project_id ?? link.projectId ?? "")
    const name = String(link.team_name ?? link.team_id ?? link.teamId ?? "").trim()
    if (!projectId || !name) continue
    const list = teamNamesByProject.get(projectId) ?? []
    if (!list.includes(name)) list.push(name)
    teamNamesByProject.set(projectId, list)
  }

  const memberLimitByProject = new Map<string, number | null>()
  for (const row of warm.projectMemberLimits) {
    const projectId = String(row.project_id ?? row.projectId ?? "")
    if (!projectId || memberLimitByProject.has(projectId)) continue
    memberLimitByProject.set(projectId, Number(row.cost ?? 0) || null)
  }

  return { budgetsByProject, memberCountByProject, memberIdsByProject, teamNamesByProject, memberLimitByProject }
}

function mapWarmProjects(warm: BootstrapWarmPayload) {
  const ctx = buildProjectListContext(warm)
  return warm.projects.map((row, idx) => {
    const id = String(row.id ?? `project-${idx}`)
    const budgetRow = ctx.budgetsByProject.get(id)
    const members = ctx.memberCountByProject.get(id) ?? 0
    return {
      id,
      name: String(row.name ?? `Project ${idx + 1}`),
      color: PROJECT_COLOR_POOL[idx % PROJECT_COLOR_POOL.length]!,
      status: row.status === "archived" ? "archived" : "active",
      teams: ctx.teamNamesByProject.get(id) ?? [],
      members: members > 0 ? members : 1,
      memberLimit: ctx.memberLimitByProject.get(id) ?? null,
      todos: { done: 0, total: 0 },
      budget: budgetRow ? { spent: 0, total: budgetRow.cost, currency: "$" } : null,
      memberIds: ctx.memberIdsByProject.get(id) ?? [],
    }
  })
}

function mapWarmTeams(warm: BootstrapWarmPayload, members: Member[]) {
  const projectsById = new Map(warm.projects.map((p) => [String(p.id ?? ""), String(p.name ?? "")]))

  return warm.teams.map((team) => {
    const teamId = String(team.id ?? "")
    const memberRelations = warm.teamMembers.filter(
      (tm) => String(tm.team_id ?? tm.teamId ?? "") === teamId,
    )
    const projectRelations = warm.teamProjects.filter(
      (tp) => String(tp.team_id ?? tp.teamId ?? "") === teamId,
    )

    const membersList = memberRelations.map((mr) => {
      const member = members.find((m) => m.id === String(mr.member_id ?? mr.memberId ?? ""))
      const displayName = member?.name || "Unknown"
      return {
        id: String(mr.member_id ?? mr.memberId ?? ""),
        name: displayName,
        avatar: member?.avatar || displayName.slice(0, 2).toUpperCase(),
        color: member?.avatarColor || "#6366f1",
        avatarUrl: member?.avatarUrl,
        role: member?.role_name || member?.role || "",
        is_lead: Boolean(mr.is_lead ?? mr.isLead),
      }
    })

    return {
      id: teamId,
      name: String(team.name ?? "Team"),
      description: typeof team.description === "string" ? team.description : "",
      members: membersList,
      leads: membersList.filter((m) => m.is_lead).map((m) => m.name),
      projects: projectRelations.map((pr) => {
        const projectId = String(pr.project_id ?? pr.projectId ?? "")
        return { id: projectId, name: projectsById.get(projectId) || projectId }
      }),
      memberCount: membersList.length,
      projectCount: projectRelations.length,
    }
  })
}

function seedCachesFromWarmBundle(warm: BootstrapWarmPayload, currentMember?: Member | null): void {
  const members = warm.members.map((row) => mapWarmMember(row))
  const projectRows = warm.projects.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    status: String(row.status ?? "active"),
  }))
  const projectContext = buildProjectListContext(warm)

  seedMembersListCache(members)
  seedNamespace("people-members", {
    ...(warm.invites ? { invites: warm.invites } : {}),
  })

  seedNamespace("pm-projects", { projects: mapWarmProjects(warm) })
  writeCache("people:teams", mapWarmTeams(warm, members))
  touchFetchTime("people:teams")

  const taskProjects = buildProjectsListForTasks(projectRows, projectContext.memberIdsByProject, members)
  seedNamespace("pm-tasks", { tasks: warm.tasks, projects: taskProjects })

  if (currentMember?.id && !warm.scopedMembers.sees_all) {
    writeCache(`hierarchy-scoped-${currentMember.id}`, warm.scopedMembers)
  }
}

async function warmCoreDataLegacy(options: WarmCoreDataOptions = {}): Promise<void> {
  const { onProgress, currentMember } = options
  report(onProgress, 1, "Loading workspace lists...")
  const [members, { projects: projectRows, context: projectContext }, teams, invites] = await Promise.all([
    getMembers({ retries: 1, fields: resolveDefaultMembersListFields() }),
    fetchEnrichedProjects(),
    fetchEnrichedTeams(),
    getInvites().catch(() => []),
  ])
  seedMembersListCache(members)
  seedNamespace("people-members", { invites })
  const PROJECT_COLOR_POOL_LEGACY = PROJECT_COLOR_POOL
  const mappedProjects = projectRows.map((p, idx) => {
    const id = p.id || `project-${idx}`
    const budgetRow = projectContext.budgetsByProject.get(id)
    return {
      id,
      name: p.name || `Project ${idx + 1}`,
      color: PROJECT_COLOR_POOL_LEGACY[idx % PROJECT_COLOR_POOL_LEGACY.length]!,
      status: p.status === "archived" ? "archived" : "active",
      teams: projectContext.teamNamesByProject.get(id) ?? [],
      members: (projectContext.memberCountByProject.get(id) ?? 0) || 1,
      memberLimit: projectContext.memberLimitByProject.get(id) ?? null,
      todos: { done: 0, total: 0 },
      budget: budgetRow ? { spent: 0, total: budgetRow.cost, currency: "$" } : null,
      memberIds: projectContext.memberIdsByProject.get(id) ?? [],
    }
  })
  seedNamespace("pm-projects", { projects: mappedProjects })
  writeCache("people:teams", teams)
  touchFetchTime("people:teams")
  report(onProgress, 2, "Loading tasks...")
  const tasks = await fetchTasksList()
  const taskProjects = buildProjectsListForTasks(projectRows, projectContext.memberIdsByProject, members)
  seedNamespace("pm-tasks", { tasks, projects: taskProjects })
  report(onProgress, 3, "Caches ready")
}

/** Background warm-up API round-trip after login. */
export async function warmCoreDataForBootstrap(options: WarmCoreDataOptions = {}): Promise<void> {
  const { onProgress, currentMember } = options
  report(onProgress, 1, "Warming workspace caches...")

  try {
    const warm = await coalesceRequest("bootstrap-warm", () => fetchBootstrapWarmBundle())
    report(onProgress, 2, "Seeding caches...")
    seedCachesFromWarmBundle(warm, currentMember)
    report(onProgress, 3, "Caches ready")
  } catch {
    await warmCoreDataLegacy(options)
  }
}

export function shouldSkipBootstrapWarm(memberId?: string): boolean {
  if (typeof window === "undefined" || !memberId) return false
  try {
    const raw = window.sessionStorage.getItem(WARM_SESSION_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { memberId?: string; warmedAt?: number }
    if (parsed.memberId !== memberId || typeof parsed.warmedAt !== "number") return false
    return Date.now() - parsed.warmedAt < BOOTSTRAP_WARM_TTL_MS
  } catch {
    return false
  }
}

export function markBootstrapWarmComplete(memberId: string): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      WARM_SESSION_KEY,
      JSON.stringify({ memberId, warmedAt: Date.now() }),
    )
  } catch {
    // ignore quota errors
  }
}

export function startBackgroundBootstrapWarm(
  _currentMember: Member | null,
  _onProgress?: (progress: BootstrapProgress) => void,
): void {
  // Disabled — list caches load on demand when the user opens a page.
}
