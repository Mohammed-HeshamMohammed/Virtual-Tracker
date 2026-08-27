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
  /** What the bar measures: task progress, budget burn, or nothing tracked yet. */
  hint: string
}

/** Intern/Employee stand-in for the "Active Members" card: their own tasks, not the team. */
export type PersonalTaskStats = {
  inProgress: number
  assigned: number
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
  /** Set only for Intern/Employee (personal view); null for every other role. */
  personalTaskStats: PersonalTaskStats | null
  chartPath: string
  chartFill: string
  weeklyTrend: WeeklyTrendDay[]
  health: ProjectHealthItem[]
  utilizationPercent: number
  utilizationOffset: number
  utilizationMembers: { optimal: number; over: number; under: number }
  utilizationBreakdown: UtilizationMember[]
}

/** One member's own hours against their own weekly capacity. */
export type UtilizationMember = {
  id: string
  name: string
  initials: string
  percent: number
  hours: number
  capacityHours: number
  load: "optimal" | "over" | "under"
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
  /** Screenshot rows only - used to load the capture through the auth-gated endpoint. */
  screenshotId?: string
}

export type CommandCenterPayload = {
  roleName: string
  isOwner: boolean
  canSeeAllProjects: boolean
  /** Intern/Employee: cards read as this person's own work, not the project's. */
  isPersonalView: boolean
  globalActivityFeed: ActivityFeedItem[]
  projects: ProjectData[]
}

/** Raw API health row before UI mapping. */
export type ApiProjectHealthItem = {
  name: string
  percent: number
  health: string
  /** Which measure the percent is: task progress, budget burn, or neither. */
  metric?: "progress" | "budget" | "none"
}

/** Raw API project row (colorIndex + health codes) before UI mapping. */
export type ApiProjectData = {
  id: string
  name: string
  colorIndex: number
  stats: ProjectData["stats"]
  personalTaskStats: PersonalTaskStats | null
  chartPath: string
  chartFill: string
  weeklyTrend: WeeklyTrendDay[]
  health: ApiProjectHealthItem[]
  utilizationPercent: number
  utilizationOffset: number
  utilizationMembers: ProjectData["utilizationMembers"]
  utilizationBreakdown: UtilizationMember[]
}

export type CommandCenterApiPayload = Omit<CommandCenterPayload, "projects"> & {
  projects: ApiProjectData[]
}
