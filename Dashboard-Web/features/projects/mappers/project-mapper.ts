import type {
  OverviewCoreProject,
  OverviewPanelActivity,
  OverviewPanelClient,
  OverviewPanelTask,
  ProjectOverviewCore,
} from "@/features/projects/api/project-overview-api"
import type { OverviewSortableProject } from "@/features/projects/utils/overview-sort"

const PROJECT_COLOR_POOL = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#8b5cf6",
  "#0ea5e9",
  "#ef4444",
  "#84cc16",
  "#a855f7",
]

export type OverviewProject = OverviewSortableProject & {
  id: string
  name: string
  color: string
  status: "active" | "archived"
  teams: string[]
  members: number
  memberLimit: number | null
}

export type OverviewTaskCard = {
  id: string
  title: string
  status: "todo" | "in_progress" | "in_review" | "blocked" | "done"
  priority: "low" | "medium" | "high" | "urgent"
  assignedTo: string | null
  projectId: string
}

export type OverviewClientRow = {
  id: string
  name: string
  status: "active" | "archived"
  email: string
  projectIds: string[]
  budgetUsed: number
  budgetTotal: number
}

function mapCoreProject(row: OverviewCoreProject): OverviewProject {
  return {
    id: row.id,
    name: row.n,
    color: PROJECT_COLOR_POOL[row.c % PROJECT_COLOR_POOL.length]!,
    status: row.s,
    teams: [],
    members: row.m,
    memberLimit: row.ml,
    todos: { done: row.p.d, total: row.p.t },
    budget: row.b ? { spent: row.b.sp, total: row.b.tot, type: row.b.ty } : null,
    health: row.h,
  }
}

export function mapCoreProjects(core: ProjectOverviewCore): OverviewProject[] {
  return core.projects.map(mapCoreProject)
}

export function mapPanelTask(row: OverviewPanelTask): OverviewTaskCard {
  return {
    id: row.id,
    title: row.t,
    status: row.st as OverviewTaskCard["status"],
    priority: row.pr as OverviewTaskCard["priority"],
    assignedTo: row.aid,
    projectId: row.pid,
  }
}

export function mapPanelClient(row: OverviewPanelClient): OverviewClientRow {
  return {
    id: row.id,
    name: row.n,
    status: row.st as OverviewClientRow["status"],
    email: row.em,
    projectIds: row.pids,
    budgetUsed: row.b?.used ?? 0,
    budgetTotal: row.b?.tot ?? 0,
  }
}

export type ProjectActivityRow = {
  id: string
  name: string
  color: string
  todo: number
  in_progress: number
  in_review: number
  blocked: number
  done: number
  total: number
  budget: { spent: number; total: number } | null
}

export function mapPanelActivity(row: OverviewPanelActivity): ProjectActivityRow {
  return {
    id: row.id,
    name: row.n,
    color: PROJECT_COLOR_POOL[row.c % PROJECT_COLOR_POOL.length]!,
    todo: row.td,
    in_progress: row.ip,
    in_review: row.ir,
    blocked: row.bl,
    done: row.dn,
    total: row.tot,
    budget: row.b ? { spent: row.b.sp, total: row.b.tot } : null,
  }
}
