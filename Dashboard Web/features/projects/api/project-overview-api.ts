import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, fetchJsonWithRetry, type RequestOptions } from "@/infrastructure/api/http"


type Envelope<T> = { success?: boolean; error?: string; data?: T }

export type OverviewHealth = "on_track" | "at_risk" | "stalled"

/** Compact project row from GET /api/projects/overview */
export type OverviewCoreProject = {
  id: string
  n: string
  s: "active" | "archived"
  h: OverviewHealth
  p: { d: number; t: number }
  b: { sp: number; tot: number } | null
  m: number
  ml: number | null
  c: number
}

export type ProjectOverviewCore = {
  summary: {
    activeProjects: number
    onTrack: number
    tasksDone: number
    tasksTotal: number
    budgetSpent: number
    budgetTotal: number
    teamMembers: number
  }
  projects: OverviewCoreProject[]
}

export type OverviewPanelTask = {
  id: string
  pid: string
  t: string
  st: string
  pr: string
  aid: string | null
}

export type OverviewPanelActivity = {
  id: string
  n: string
  c: number
  td: number
  ip: number
  ir: number
  bl: number
  dn: number
  tot: number
}

export type OverviewPanelClient = {
  id: string
  n: string
  st: string
  em: string
  pc: number
  pids: string[]
  b: { used: number; tot: number } | null
}

export type ProjectOverviewPanels = {
  tasks: OverviewPanelTask[]
  assignees: Record<string, string>
  projectActivity: OverviewPanelActivity[]
  clients: OverviewPanelClient[]
}

export async function getProjectOverviewCore(
  options: RequestOptions = {},
): Promise<ProjectOverviewCore> {
  const { res, json } = await fetchJsonWithRetry<Envelope<ProjectOverviewCore>>(
    apiPath("/api/projects/overview"),
    { headers: { "Accept-Encoding": "gzip, deflate, br" } },
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to load project overview", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load project overview")
  return json.data
}

export async function getProjectOverviewPanels(
  options: RequestOptions & { taskLimit?: number } = {},
): Promise<ProjectOverviewPanels> {
  const params = new URLSearchParams()
  if (options.taskLimit != null) params.set("task_limit", String(options.taskLimit))

  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<Envelope<ProjectOverviewPanels>>(
    apiPath(`/api/projects/overview/panels${query}`),
    { headers: { "Accept-Encoding": "gzip, deflate, br" } },
    { ...options, retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to load overview panels", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load overview panels")
  return json.data
}
