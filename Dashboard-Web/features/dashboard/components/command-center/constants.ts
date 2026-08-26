// ============================================================================
// Dashboard: Command Center — UI types (data from GET /api/dashboard/command-center)
// ============================================================================

export type WeeklyTrendDay = {
  key: string
  label: string
  /** Hours actively worked that day (was: a count of task rows touched). */
  active: number
  /** Hours idle within tracked sessions that day. */
  idle: number
  activeSeconds: number
  idleSeconds: number
  tasks: {
    id: string
    title: string
    status: string
    assigneeId: string | null
    assigneeName: string | null
  }[]
}

export type ProjectHealthItem = {
  name: string
  percent: number
  status: string
  statusColor: string
  barColor: string
}

export interface ProjectData {
  id: string
  name: string
  color: string
  stats: {
    timeWorked: string
    /** Week-over-week change in tracked hours; null when there is no prior week to compare. */
    timeWorkedTrendPercent: number | null
    activeMembers: string
    totalMembers: string
    budgetPercent: number
    budgetLabel: string
    activityPercent: number
    activityBadge: string
  }
  chartPath: string
  chartFill: string
  weeklyTrend: WeeklyTrendDay[]
  health: ProjectHealthItem[]
  utilizationPercent: number
  utilizationOffset: number
  utilizationMembers: { optimal: number; over: number; under: number }
}

export type ActivityFeedItem = {
  person: string
  avatar: string
  action: string
  task?: string
  project: string
  time: string
  activityBadge?: string
  type: "screenshot" | "task"
}

export type CommandCenterPayload = {
  roleName: string
  isOwner: boolean
  canSeeAllProjects: boolean
  globalActivityFeed: ActivityFeedItem[]
  projects: ProjectData[]
}

/** Raw API health row before UI mapping. */
export type ApiProjectHealthItem = {
  name: string
  percent: number
  health: string
  /** Set when the project has no tasks at all, so the bar is not presented as
   *  real progress. */
  empty?: boolean
}

/** Raw API project row (colorIndex + health codes) before UI mapping. */
export type ApiProjectData = {
  id: string
  name: string
  colorIndex: number
  stats: ProjectData["stats"]
  chartPath: string
  chartFill: string
  weeklyTrend: WeeklyTrendDay[]
  health: ApiProjectHealthItem[]
  utilizationPercent: number
  utilizationOffset: number
  utilizationMembers: ProjectData["utilizationMembers"]
}

export type CommandCenterApiPayload = Omit<CommandCenterPayload, "projects"> & {
  projects: ApiProjectData[]
}
