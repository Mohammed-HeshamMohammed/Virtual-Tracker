
export type WeeklyTrendDay = {
  key: string
  label: string
  active: number
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
  hint: string
}

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
    timeWorkedTrendPercent: number | null
    activeMembers: string
    totalMembers: string
    budgetPercent: number
    budgetLabel: string
    activityPercent: number
    activityBadge: string
  }
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
  screenshotId?: string
}

export type CommandCenterPayload = {
  roleName: string
  isOwner: boolean
  canSeeAllProjects: boolean
  isPersonalView: boolean
  globalActivityFeed: ActivityFeedItem[]
  projects: ProjectData[]
}

export type ApiProjectHealthItem = {
  name: string
  percent: number
  health: string
  metric?: "progress" | "budget" | "none"
}

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
