import React from "react"
import { Circle, Clock, AlertCircle, Ban, CheckCircle2 } from "lucide-react"

// ============================================================================
// Clients Configuration
// ============================================================================

export type BudgetType = "hourly" | "fixed" | "retainer" | "none"
export type BudgetBase = "per_person" | "per_project" | "total"
export type BudgetReset = "monthly" | "quarterly" | "yearly" | "never"

export const BUDGET_TYPES: { value: BudgetType; label: string }[] = [
  { value: "hourly", label: "Hourly rate" },
  { value: "fixed", label: "Fixed price" },
  { value: "retainer", label: "Retainer" },
  { value: "none", label: "No budget" },
]

export const BUDGET_BASES: { value: BudgetBase; label: string }[] = [
  { value: "per_person", label: "Per person" },
  { value: "per_project", label: "Per project" },
  { value: "total", label: "Total" },
]

export const BUDGET_RESETS: { value: BudgetReset; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "never", label: "Never" },
]

export const LINE_ITEM_GROUPS = [
  {
    group: "Detailed by project",
    items: [
      { value: "detailed_project_user_date", label: "By user, project, and date", example: "Jon Doe · Development (Thu, Jan 1, 2026)" },
      { value: "detailed_project_date", label: "By project and date", example: "Development (Thu, Jan 1, 2026)" },
      { value: "detailed_project_user", label: "By user and project", example: "Jon Doe · Development (Jan 1 – Jan 8, 2026)" },
    ],
  },
  {
    group: "Detailed by to-do",
    items: [
      { value: "detailed_todo_user_date", label: "By user, to-do, and date", example: "Jon Doe · Upgrade database (Thu, Jan 1, 2026)" },
      { value: "detailed_todo_date", label: "By to-do and date", example: "Upgrade database (Thu, Jan 1, 2026)" },
      { value: "detailed_todo_user", label: "By user and to-do", example: "Jon Doe · Upgrade database (Jan 1 – Jan 8, 2026)" },
    ],
  },
  {
    group: "Summary",
    items: [
      { value: "summary_user_date", label: "By user and date", example: "Jon Doe (Thu, Jan 1, 2026)" },
      { value: "summary_user", label: "By user", example: "Jon Doe (Jan 1 – Jan 8, 2026)" },
      { value: "summary_project", label: "By project", example: "Development (Jan 1 – Jan 8, 2026)" },
      { value: "summary_todo", label: "By to-do", example: "Upgrade database (Jan 1 – Jan 8, 2026)" },
      { value: "summary_date", label: "By date", example: "Thu, Jan 1, 2026" },
    ],
  },
]

export const MODAL_TABS = ["General", "Contact info", "Projects", "Budget", "Invoicing"] as const
export type ModalTab = typeof MODAL_TABS[number]

export const ALL_CLIENT_COLS = [
  { key: "budget", label: "Budget" },
  { key: "auto_invoicing", label: "Auto-invoicing" },
  { key: "projects", label: "Projects" },
] as const

export const DEFAULT_CLIENT_COL_ORDER = ALL_CLIENT_COLS.map((c) => c.key)
export const DEFAULT_ENABLED_CLIENT_COLS = new Set<string>(DEFAULT_CLIENT_COL_ORDER)

export const CLIENT_COL_AUTO_HIDE_PRIORITY = ["projects", "auto_invoicing", "budget"] as const
export const CLIENT_COL_MIN_WIDTH: Record<string, number> = { budget: 120, auto_invoicing: 140, projects: 160 }

// ============================================================================
// Projects Configuration
// ============================================================================

export const ALL_PROJECT_COLS = [
  { key: "teams", label: "Teams" },
  { key: "members", label: "Members" },
  { key: "todos", label: "To-dos" },
  { key: "budget", label: "Budget" },
  { key: "member_limits", label: "Member limits" },
] as const

export const DEFAULT_PROJECT_COL_ORDER = ALL_PROJECT_COLS.map((c) => c.key)
export const DEFAULT_ENABLED_PROJECT_COLS = new Set<string>(DEFAULT_PROJECT_COL_ORDER)

export const PROJECT_COL_AUTO_HIDE_PRIORITY = ["member_limits", "budget", "todos", "members", "teams"] as const
export const PROJECT_COL_MIN_WIDTH: Record<string, number> = { teams: 120, members: 96, todos: 96, budget: 140, member_limits: 120 }
export const PROJECT_NAME_COL_MIN_WIDTH = 260
export const PROJECT_SELECT_COL_WIDTH = 52
export const PROJECT_ACTIONS_COL_WIDTH = 52

export function getProjectsTableFixedWidth(options: {
  showSelectColumn: boolean
  showActionsColumn: boolean
}): number {
  return (
    (options.showSelectColumn ? PROJECT_SELECT_COL_WIDTH : 0) +
    PROJECT_NAME_COL_MIN_WIDTH +
    (options.showActionsColumn ? PROJECT_ACTIONS_COL_WIDTH : 0)
  )
}

export function getProjectsTableMinWidth(
  visibleColKeys: readonly string[],
  options: { showSelectColumn: boolean; showActionsColumn: boolean },
): number {
  return (
    getProjectsTableFixedWidth(options) +
    visibleColKeys.reduce((sum, key) => sum + (PROJECT_COL_MIN_WIDTH[key] ?? 100), 0)
  )
}

export const PROJECTS_TABLE_ROWS_COMPACT_MAX = 5
export const PROJECTS_TABLE_ROW_CAP_BY_BREAKPOINT = [
  { minWidth: 1536, maxRows: 12 },
  { minWidth: 1280, maxRows: 10 },
  { minWidth: 1024, maxRows: 8 },
  { minWidth: 0, maxRows: PROJECTS_TABLE_ROWS_COMPACT_MAX },
] as const

const PROJECT_COLOR_POOL = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]

// ============================================================================
// Tasks Configuration
// ============================================================================

export type ViewMode = "list" | "board" | "timeline"
export type Priority = "low" | "medium" | "high" | "urgent"
export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done"

export interface Member {
  id: string
  name: string
  avatar: string
  color: string
}

export interface TaskSubtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignedTo: string | null
  assigneeIds?: string[]
  projectId: string
  teamId: string | null
  durationHoursPerDay: number | null
  durationDays: number | null
  overtimeHoursPerDay: number | null
  rollingHourCap?: boolean
  sharedTaskBudget?: boolean
  startDate: string | null
  dueDate: string | null
  completed: boolean
  orderIndex: number
  subtasks?: TaskSubtask[]
  createdAt: string
  createdBy: string
  updatedBy: string
  reviewState: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  totalAssignees?: number | null
  startedAssignees?: number | null
  notStartedAssignees?: number | null
  participationPercent?: number | null
  allAssigneesStarted?: boolean
  /** Optimistic-concurrency token (§6.9) - sent back unchanged on save. */
  updatedAt?: string
}

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  todo:        { label: "To do",       color: "text-slate-500",  bg: "bg-slate-100", icon: <Circle className="w-3.5 h-3.5" /> },
  in_progress: { label: "In progress", color: "text-blue-600",   bg: "bg-blue-50",   icon: <Clock className="w-3.5 h-3.5" /> },
  in_review:   { label: "In review",   color: "text-amber-600",  bg: "bg-amber-50",  icon: <AlertCircle className="w-3.5 h-3.5" /> },
  blocked:     { label: "Blocked",     color: "text-red-600",     bg: "bg-red-50",    icon: <Ban className="w-3.5 h-3.5" /> },
  done:        { label: "Done",        color: "text-emerald-600", bg: "bg-emerald-50", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
}

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; dot: string }> = {
  low:    { label: "Low",    color: "text-slate-400",  dot: "bg-slate-300" },
  medium: { label: "Medium", color: "text-blue-500",   dot: "bg-blue-400"  },
  high:   { label: "High",   color: "text-amber-600",  dot: "bg-amber-400" },
  urgent: { label: "Urgent", color: "text-red-500",    dot: "bg-red-400"   },
}

export const BOARD_COLUMNS: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done"]
export const TASK_PROJECT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]
export const MEMBER_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]

function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return ""
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function parseDurationInputToMinutes(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const asNumber = Number(trimmed)
  if (!Number.isFinite(asNumber) || asNumber < 0) return null
  return Math.round(asNumber * 60)
}

function minutesToHoursInput(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return ""
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100)
}

function toDateInputValue(value: string | null): string {
  if (!value) return ""
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

export function formatTaskDate(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
