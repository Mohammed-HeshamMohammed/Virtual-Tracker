import type { LayoutBlock } from "@/features/dashboard/components/general/lib/layout-engine"

export type DashboardView = "me" | "all"

export type UserStatus = "Working" | "Idle" | "Offline"

export type DashboardStats = {
  workedTodayHours: number
  workedWeekHours: number
  workedSparkline: number[]
  spentTodayHours: number
  spentWeekHours: number
  spentSparkline: number[]
  activityTodayPercent: number
  activityWeekPercent: number
  activitySparkline: number[]
  membersWorkedToday: number
  membersSparkline: number[]
  projectsWorkedToday: number
  projectsSparkline: number[]
}

export type DashboardTodo = {
  id: string
  title: string
  projectName: string
  status: string
  priority: string
  done: boolean
}

export type OnlineMember = {
  id: string
  name: string
  initials: string
  status: UserStatus
  lastActive: string
  project: string
  time: string
}

export type RecentProject = {
  id: string
  name: string
  progress: number
  memberCount: number
  colorIndex: number
}

export type BudgetRow = {
  id: string
  name: string
  spentPercent: number
  total: number
  remaining: number
  spent: number
}

export type WeeklyActivityDay = {
  key: string
  label: string
  activeHours: number
  idleHours: number
}

export type TopApp = {
  name: string
  totalSeconds: number
  percent: number
}

export type DashboardViewData = {
  stats: DashboardStats
  todos: DashboardTodo[]
  onlineMembers: OnlineMember[]
  recentProjects: RecentProject[]
  budgets: BudgetRow[]
  weeklyActivity: WeeklyActivityDay[]
  chartPath: string
  chartFill: string
  topApps: TopApp[]
}

export type GeneralDashboardPayload = {
  roleName: string
  canAccessAllView: boolean
  me: DashboardViewData
  all: DashboardViewData
}

export type WidgetSize = "stat" | "panel"

export type WidgetDefinition = {
  id: string
  label: string
  size: WidgetSize
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  { id: "worked_week", label: "Worked this week", size: "stat" },
  { id: "worked_today", label: "Worked today", size: "stat" },
  { id: "activity_today", label: "Today's activity", size: "stat" },
  { id: "spent_week", label: "Billable this week", size: "stat" },
  { id: "spent_today", label: "Billable today", size: "stat" },
  { id: "activity_week", label: "Weekly activity", size: "stat" },
  { id: "members", label: "Members worked", size: "stat" },
  { id: "projects", label: "Projects worked", size: "stat" },
  { id: "todos", label: "Tasks", size: "panel" },
  { id: "online", label: "Team presence", size: "panel" },
  { id: "screenshots", label: "Screenshots", size: "panel" },
  { id: "apps_urls", label: "Apps & URLs", size: "panel" },
  { id: "budgets", label: "Project budgets", size: "panel" },
  { id: "weekly_activity", label: "Weekly trends", size: "panel" },
  { id: "recent_projects", label: "Recent projects", size: "panel" },
]

/**
 * Fixed dashboard layout — all widgets, stat pairs stacked, panels at panel height.
 *
 * Grid (12 cols): stat column = 2, panel = 6. Two stacked stats = one panel height.
 * Row 1: [worked][activity][billable day] | Tasks
 * Row 2: [members/projects] | Team presence | (Screenshots wraps)
 * Row 3: Screenshots | Apps
 * Row 4: Budgets | Weekly trends
 * Row 5: Recent projects
 */
export const DEFAULT_DASHBOARD_LAYOUT: LayoutBlock[] = [
  { kind: "stack", id: "stack-worked", widgetIds: ["worked_week", "worked_today"] },
  { kind: "stack", id: "stack-activity", widgetIds: ["activity_today", "spent_week"] },
  { kind: "stack", id: "stack-billable", widgetIds: ["spent_today", "activity_week"] },
  { kind: "panel", id: "panel-todos", widgetId: "todos" },
  { kind: "stack", id: "stack-team", widgetIds: ["members", "projects"] },
  { kind: "panel", id: "panel-online", widgetId: "online" },
  { kind: "panel", id: "panel-screenshots", widgetId: "screenshots" },
  { kind: "panel", id: "panel-apps", widgetId: "apps_urls" },
  { kind: "panel", id: "panel-budgets", widgetId: "budgets" },
  { kind: "panel", id: "panel-weekly", widgetId: "weekly_activity" },
  { kind: "panel", id: "panel-projects", widgetId: "recent_projects" },
]

export const PROJECT_COLORS = [
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
] as const

/** Full panel block height (px). Two stacked stats + gap equals this. */
export const DASHBOARD_PANEL_HEIGHT_PX = 420
/** Must match `gap-5` on the dashboard grid (1.25rem). */
export const DASHBOARD_GRID_GAP_PX = 20
/** Height of one stat slot inside a stack. */
export const DASHBOARD_STAT_SLOT_PX = (DASHBOARD_PANEL_HEIGHT_PX - DASHBOARD_GRID_GAP_PX) / 2

export function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
