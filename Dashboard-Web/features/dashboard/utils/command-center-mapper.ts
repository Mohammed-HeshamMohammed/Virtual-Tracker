import type {
  ActivityFeedItem,
  CommandCenterApiPayload,
  ProjectData,
  ProjectHealthItem,
} from "@/features/dashboard/components/command-center/constants"

const PROJECT_COLORS = [
  "bg-emerald-500",
  "bg-amber-500",
  "bg-blue-500",
  "bg-red-500",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-slate-400",
] as const

function healthUi(health: string): Pick<ProjectHealthItem, "status" | "statusColor" | "barColor"> {
  if (health === "on_track") {
    return { status: "ON TRACK", statusColor: "text-emerald-600 dark:text-emerald-400", barColor: "bg-emerald-500" }
  }
  if (health === "at_risk") {
    return { status: "AT RISK", statusColor: "text-amber-600 dark:text-amber-400", barColor: "bg-amber-500" }
  }
  return { status: "STALLED", statusColor: "text-slate-400 dark:text-slate-500", barColor: "bg-slate-300 dark:bg-slate-600" }
}

function mapHealth(items: CommandCenterApiPayload["projects"][number]["health"]): ProjectHealthItem[] {
  return items.map((item) => {
    const ui = healthUi(item.health)
    // A project with no tasks has no progress to report - saying "ON TRACK" at
    // 0% would read as a real measurement rather than an absence of one.
    if (item.empty) {
      return {
        name: item.name,
        percent: 0,
        status: "NO TASKS",
        statusColor: "text-slate-400 dark:text-slate-500",
        barColor: "bg-slate-200 dark:bg-slate-700",
      }
    }
    return {
      name: item.name,
      percent: item.percent,
      status: ui.status,
      statusColor: ui.statusColor,
      barColor: ui.barColor,
    }
  })
}

function mapProject(project: CommandCenterApiPayload["projects"][number]): ProjectData {
  return {
    id: project.id,
    name: project.name,
    color: PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length] ?? "bg-slate-400",
    stats: project.stats,
    chartPath: project.chartPath,
    chartFill: project.chartFill,
    weeklyTrend: project.weeklyTrend,
    health: mapHealth(project.health),
    utilizationPercent: project.utilizationPercent,
    utilizationOffset: project.utilizationOffset,
    utilizationMembers: project.utilizationMembers,
  }
}

export function mapCommandCenterPayload(payload: CommandCenterApiPayload): {
  projects: ProjectData[]
  globalActivityFeed: ActivityFeedItem[]
  canSeeAllProjects: boolean
  roleName: string
} {
  return {
    projects: payload.projects.map(mapProject),
    globalActivityFeed: payload.globalActivityFeed,
    canSeeAllProjects: payload.canSeeAllProjects,
    roleName: payload.roleName,
  }
}
