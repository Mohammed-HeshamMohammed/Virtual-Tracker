import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { cn } from "@/shared/utils/utils"
import { Circle, Clock, AlertCircle, Ban, CheckCircle2 } from "lucide-react"

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
  projectId: string
  teamId: string | null
  durationHoursPerDay: number | null
  durationDays: number | null
  overtimeHoursPerDay: number | null
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
}

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  todo:        { label: "To do",       color: "text-slate-500 dark:text-slate-400",     bg: "bg-slate-100 dark:bg-slate-800",       icon: <Circle className="w-3.5 h-3.5" /> },
  in_progress: { label: "In progress", color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/60",       icon: <Clock className="w-3.5 h-3.5" /> },
  in_review:   { label: "In review",   color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/60",     icon: <AlertCircle className="w-3.5 h-3.5" /> },
  blocked:     { label: "Blocked",     color: "text-red-600 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/60",         icon: <Ban className="w-3.5 h-3.5" /> },
  done:        { label: "Done",        color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/60", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
}

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; dot: string }> = {
  low:    { label: "Low",    color: "text-slate-400 dark:text-slate-500",  dot: "bg-slate-300" },
  medium: { label: "Medium", color: "text-blue-500 dark:text-blue-400",    dot: "bg-blue-400"  },
  high:   { label: "High",   color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-400" },
  urgent: { label: "Urgent", color: "text-red-500 dark:text-red-400",     dot: "bg-red-400"   },
}

export const BOARD_COLUMNS: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done"]

export const TASK_PROJECT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]
export const MEMBER_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return ""
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

export function parseDurationInputToMinutes(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const asNumber = Number(trimmed)
  if (!Number.isFinite(asNumber) || asNumber < 0) return null
  return Math.round(asNumber * 60)
}

export function minutesToHoursInput(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return ""
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100)
}

export function toDateInputValue(value: string | null): string {
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

export function AvatarBubble({ member, size = "sm" }: { member: Member; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-6 h-6 text-[10px]" : "w-7 h-7 text-xs"
  return (
    <IconTooltip text={member.name} placement="top">
      <div
        className={cn(dim, "rounded-full flex items-center justify-center font-semibold text-white shrink-0")}
        style={{ backgroundColor: member.color }}
      >
        {member.avatar}
      </div>
    </IconTooltip>
  )
}

export function PriorityDot({ priority }: { priority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium
  return <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
}
