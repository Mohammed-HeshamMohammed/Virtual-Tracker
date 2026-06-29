/* eslint-disable react-doctor/use-lazy-motion, react-doctor/no-initialize-state, react-doctor/exhaustive-deps, react-doctor/no-derived-state, react-doctor/js-min-max-loop */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import type { ReactNode, MouseEvent } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  PanelRightOpen,
  Circle,
  Clock,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { fade } from "@/features/tasks/constants/motion"

type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done"
type Priority = "low" | "medium" | "high" | "urgent"

interface Member {
  id: string
  name: string
  avatar: string
  color: string
}

interface TimelineTask {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignedTo: string | null
  dueDate: string | null
  completed: boolean
  createdBy: string
}

interface TasksTimelineCalendarProps {
  tasks: TimelineTask[]
  members: Member[]
  showCompleted: boolean
  search: string
  isDark: boolean
  onTaskPreview?: (task: TimelineTask, event: MouseEvent) => void
}

type CalendarMode = "month" | "week"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const WEEKDAYS_SHORT = ["M", "T", "W", "T", "F", "S", "S"] as const
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: ReactNode; chipDark: string; chipLight: string }
> = {
  todo: {
    label: "To do",
    icon: <Circle className="h-3 w-3" />,
    chipDark: "bg-[#2e3447] text-[#dce1fb] border-[#3d4a3d]/50",
    chipLight: "bg-slate-100 text-slate-700 border-slate-200",
  },
  in_progress: {
    label: "In progress",
    icon: <Clock className="h-3 w-3" />,
    chipDark: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    chipLight: "bg-blue-50 text-blue-700 border-blue-100",
  },
  in_review: {
    label: "In review",
    icon: <AlertCircle className="h-3 w-3" />,
    chipDark: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    chipLight: "bg-amber-50 text-amber-700 border-amber-100",
  },
  blocked: {
    label: "Blocked",
    icon: <AlertCircle className="h-3 w-3" />,
    chipDark: "bg-red-500/15 text-red-300 border-red-500/30",
    chipLight: "bg-red-50 text-red-700 border-red-100",
  },
  done: {
    label: "Done",
    icon: <CheckCircle2 className="h-3 w-3" />,
    chipDark: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    chipLight: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
}

const PRIORITY_DOT: Record<Priority, string> = {
  low: "bg-slate-400",
  medium: "bg-blue-400",
  high: "bg-amber-400",
  urgent: "bg-red-500",
}

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseDueDate(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addMonths(d: Date, count: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + count, 1)
}

function addDays(d: Date, count: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + count)
  return startOfDay(next)
}

function getMondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

function getMonthGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const year = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(year, m, 1)
  const leading = getMondayIndex(first)
  const cells: { date: Date; inMonth: boolean }[] = []

  for (let i = 0; i < 42; i++) {
    const day = i - leading + 1
    const date = new Date(year, m, day)
    cells.push({ date: startOfDay(date), inMonth: date.getMonth() === m })
  }
  return cells
}

function getWeekDays(anchor: Date): Date[] {
  const mondayOffset = getMondayIndex(anchor)
  const monday = addDays(anchor, -mondayOffset)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

function MemberAvatar({
  member,
  isDark,
}: {
  member: Member
  isDark: boolean
}) {
  return (
    <IconTooltip text={member.name} placement="top">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
        style={{ backgroundColor: member.color }}
      >
        {member.avatar}
      </span>
    </IconTooltip>
  )
}

function TaskChip({
  task,
  member,
  isDark,
  compact,
  onDoubleClick,
}: {
  task: TimelineTask
  member: Member | null
  isDark: boolean
  compact?: boolean
  onDoubleClick?: (event: MouseEvent) => void
}) {
  const meta = STATUS_META[task.status]
  const today = startOfDay(new Date())
  const due = task.dueDate ? parseDueDate(task.dueDate) : null
  const isOverdue = due !== null && due < today && !task.completed

  const priorityBorder = 
    task.priority === "urgent" ? "border-red-500" :
    task.priority === "high" ? "border-amber-500" :
    task.priority === "medium" ? "border-blue-500" :
    "border-slate-300"

  const chipClass = cn(
    "flex w-full min-w-0 items-center gap-1.5 rounded-md border-l-4 border-y border-r px-1.5 py-1 text-left",
    priorityBorder,
    compact ? "text-[10px]" : "text-xs",
    isDark ? "bg-[#191f31]/90" : "bg-white", // removed meta.chipDark which overrides border
    isOverdue && (isDark ? "ring-1 ring-red-400/40" : "ring-1 ring-red-300"),
    task.completed && "opacity-60",
  )

  if (compact) {
    return (
      <IconTooltip text={task.title} placement="top">
        <div
          className={cn(chipClass, onDoubleClick && "cursor-pointer")}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onDoubleClick?.(event)
          }}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
          <span className={cn("min-w-0 flex-1 truncate font-medium", task.completed && "line-through")}>
            {task.title}
          </span>
        </div>
      </IconTooltip>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(chipClass, onDoubleClick && "cursor-pointer")}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleClick?.(event)
      }}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
      <span className={cn("min-w-0 flex-1 truncate font-medium", task.completed && "line-through")}>
        {task.title}
      </span>
      {member ? <MemberAvatar member={member} isDark={isDark} /> : null}
    </motion.div>
  )
}

export function TasksTimelineCalendar({
  tasks,
  members,
  showCompleted,
  search,
  isDark,
  onTaskPreview,
}: TasksTimelineCalendarProps) {
  const t = isDark ? dark : light
  const today = startOfDay(new Date())
  const userNavigated = useRef(false)

  const [mode, setMode] = useState<CalendarMode>("month")

  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setMode("week")
  }, [])
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(today)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  const visible = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (!showCompleted && (task.completed || task.status === "done")) return false
          if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
          return !!task.dueDate
        })
        .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()),
    [tasks, showCompleted, search],
  )

  const withoutDue = useMemo(
    () =>
      tasks.filter((task) => {
        if (!showCompleted && (task.completed || task.status === "done")) return false
        if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
        return !task.dueDate
      }),
    [tasks, showCompleted, search],
  )

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TimelineTask[]>()
    for (const task of visible) {
      const due = parseDueDate(task.dueDate!)
      if (!due) continue
      const key = toDateKey(due)
      const list = map.get(key) ?? []
      list.push(task)
      map.set(key, list)
    }
    return map
  }, [visible])

  useEffect(() => {
    if (userNavigated.current || visible.length === 0) return
    const dates = visible
      .map((task) => parseDueDate(task.dueDate!))
      .filter((d): d is Date => d !== null)
    if (dates.length === 0) return
    const now = today.getTime()
    const upcoming = dates.filter((d) => d.getTime() >= now).sort((a, b) => a.getTime() - b.getTime())
    const pick = upcoming[0] ?? dates.sort((a, b) => a.getTime() - b.getTime())[0]!
    setAnchorDate(new Date(pick.getFullYear(), pick.getMonth(), 1))
    setSelectedDay(pick)
  }, [visible])

  const monthCells = useMemo(() => getMonthGrid(anchorDate), [anchorDate])
  const weekDays = useMemo(() => getWeekDays(selectedDay ?? anchorDate), [selectedDay, anchorDate])

  const headerLabel =
    mode === "month"
      ? `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
      : (() => {
          const start = weekDays[0]!
          const end = weekDays[6]!
          if (start.getMonth() === end.getMonth()) {
            return `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
          }
          return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        })()

  const selectedTasks = selectedDay ? (tasksByDay.get(toDateKey(selectedDay)) ?? []) : []

  const weekTaskCount = useMemo(
    () => weekDays.reduce((sum, d) => sum + (tasksByDay.get(toDateKey(d))?.length ?? 0), 0),
    [weekDays, tasksByDay],
  )

  function goPrev() {
    userNavigated.current = true
    if (mode === "month") {
      setAnchorDate((d) => addMonths(d, -1))
    } else {
      const next = addDays(selectedDay ?? anchorDate, -7)
      setAnchorDate(next)
      setSelectedDay(next)
    }
  }

  function goNext() {
    userNavigated.current = true
    if (mode === "month") {
      setAnchorDate((d) => addMonths(d, 1))
    } else {
      const next = addDays(selectedDay ?? anchorDate, 7)
      setAnchorDate(next)
      setSelectedDay(next)
    }
  }

  function goToday() {
    userNavigated.current = true
    setSelectedDay(today)
    setAnchorDate(mode === "month" ? new Date(today.getFullYear(), today.getMonth(), 1) : today)
  }

  return (
    <motion.div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm",
        t.tableBorder,
        t.tableBg,
      )}
      {...fade}
    >
      {/* Toolbar */}
      <div
        className={cn(
          "flex shrink-0 flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4",
          t.tableBorder,
          isDark ? "bg-[#191f31]/80" : "bg-slate-50/80",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
              t.tableBorder,
              isDark ? "hover:bg-[#2e3447]" : "hover:bg-white",
            )}
            aria-label="Previous"
          >
            <ChevronLeft className={cn("h-4 w-4", t.tableCellMuted)} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
              t.tableBorder,
              isDark ? "hover:bg-[#2e3447]" : "hover:bg-white",
            )}
            aria-label="Next"
          >
            <ChevronRight className={cn("h-4 w-4", t.tableCellMuted)} />
          </button>
          <h3 className={cn("min-w-0 max-w-36 truncate text-sm font-semibold sm:max-w-none sm:min-w-40", t.tableCell)}>
            {headerLabel}
          </h3>
          <button
            type="button"
            onClick={goToday}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              t.tableBorder,
              isDark ? "text-[#4be277] hover:bg-[#2e3447]" : "text-blue-600 hover:bg-white",
            )}
          >
            Today
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className={cn("inline-flex gap-0.5 rounded-lg p-0.5", isDark ? "bg-[#0c1324]" : "bg-slate-200/80")}>
            {(["month", "week"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all",
                  mode === m ? t.tabActive : t.tabInactive,
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <IconTooltip
            text={detailsOpen ? "Hide day details" : "Show day details"}
            placement="bottom"
          >
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-label={detailsOpen ? "Hide day details" : "Show day details"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                t.tableBorder,
                detailsOpen
                  ? isDark
                    ? "bg-[#4be277]/15 text-[#4be277]"
                    : "bg-blue-50 text-blue-600"
                  : isDark
                    ? "text-[#bccbb9] hover:bg-[#2e3447]"
                    : "text-slate-600 hover:bg-white",
              )}
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Details</span>
            </button>
          </IconTooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Calendar grid */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "grid shrink-0 grid-cols-7 gap-px border-b p-px",
              t.tableBorder,
              isDark ? "bg-[#3d4a3d]/50" : "bg-slate-200",
            )}
          >
            {mode === "month"
              ? WEEKDAYS.map((day, dayIndex) => (
                  <div
                    key={day}
                    className={cn(
                      "px-0.5 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wider sm:px-1 sm:py-2 sm:text-[10px]",
                      t.tableBg,
                      t.tableCellMuted,
                    )}
                  >
                    <span className="sm:hidden">{WEEKDAYS_SHORT[dayIndex]}</span>
                    <span className="hidden sm:inline">{day}</span>
                  </div>
                ))
              : weekDays.map((date, dayIndex) => {
                  const isToday = isSameDay(date, today)
                  const isSelected = selectedDay !== null && isSameDay(date, selectedDay)
                  return (
                    <button
                      key={toDateKey(date)}
                      type="button"
                      onClick={() => setSelectedDay(date)}
                      className={cn(
                        "flex flex-col items-center gap-0.5 px-1 py-2 transition-colors",
                        t.tableBg,
                        isSelected && (isDark ? "bg-[#4be277]/10" : "bg-blue-50"),
                        !isSelected && (isDark ? "hover:bg-[#2e3447]/50" : "hover:bg-white"),
                      )}
                    >
                      <span
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider leading-none",
                          isToday ? (isDark ? "text-[#4be277]" : "text-blue-600") : t.tableCellMuted,
                        )}
                      >
                        {WEEKDAYS[dayIndex]}
                      </span>
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold",
                          isToday
                            ? isDark
                              ? "bg-[#4be277] text-[#0c1324]"
                              : "bg-blue-500 text-white"
                            : t.tableCell,
                        )}
                      >
                        {date.getDate()}
                      </span>
                    </button>
                  )
                })}
          </div>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto">
            <AnimatePresence mode="wait">
              {mode === "month" ? (
                <motion.div
                  key={`month-${anchorDate.getFullYear()}-${anchorDate.getMonth()}`}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "grid w-full flex-1 grid-cols-7 gap-px p-px",
                    "h-full min-h-[500px] grid-rows-[repeat(6,minmax(0,1fr))]",
                    isDark ? "bg-[#3d4a3d]/50" : "bg-slate-200",
                  )}
                >
                  {monthCells.map(({ date, inMonth }, i) => {
                    const key = toDateKey(date)
                    const dayTasks = tasksByDay.get(key) ?? []
                    const isToday = isSameDay(date, today)
                    const isSelected = selectedDay !== null && isSameDay(date, selectedDay)
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6

                    return (
                      <button
                        key={`${key}-${i}`}
                        type="button"
                        onClick={() => setSelectedDay(date)}
                        className={cn(
                          "flex h-full min-h-0 flex-col overflow-hidden p-1.5 text-left transition-colors sm:p-2",
                          t.tableBg,
                          !inMonth && (isDark ? "bg-[#0c1324]/80 opacity-60" : "bg-slate-100/80 opacity-70"),
                          inMonth && isWeekend && (isDark ? "bg-[#191f31]/90" : "bg-slate-50/90"),
                          inMonth && isSelected && (isDark ? "bg-[#4be277]/15" : "bg-blue-50"),
                          inMonth && !isSelected && (isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50"),
                        )}
                      >
                        <div className="mb-1 flex shrink-0 items-center justify-between gap-1">
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                              isToday
                                ? isDark
                                  ? "bg-[#4be277] text-[#0c1324]"
                                  : "bg-blue-500 text-white"
                                : inMonth
                                  ? t.tableCell
                                  : t.tableCellMuted,
                            )}
                          >
                            {date.getDate()}
                          </span>
                          {dayTasks.length > 0 && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                isDark ? "bg-[#4be277]/20 text-[#4be277]" : "bg-blue-100 text-blue-700",
                              )}
                            >
                              {dayTasks.length}
                            </span>
                          )}
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                          {dayTasks.length > 0 ? (
                            <span
                              className={cn(
                                "shrink-0 text-[9px] font-semibold sm:hidden",
                                isDark ? "text-[#4be277]" : "text-blue-600",
                              )}
                            >
                              {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          <div className="hidden min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto sm:flex">
                            {dayTasks.slice(0, 3).map((task) => (
                              <TaskChip
                                key={task.id}
                                task={task}
                                member={task.assignedTo ? memberMap[task.assignedTo] ?? null : null}
                                isDark={isDark}
                                compact
                                onDoubleClick={(event) => onTaskPreview?.(task, event)}
                              />
                            ))}
                            {dayTasks.length > 3 ? (
                              <span className={cn("shrink-0 text-[9px] font-medium", t.tableCellMuted)}>
                                +{dayTasks.length - 3} more
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key={`week-${toDateKey(weekDays[0]!)}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="flex h-full min-h-0 flex-1 flex-col"
                >
                {weekTaskCount === 0 && visible.length > 0 && (
                  <div
                    className={cn(
                      "shrink-0 border-b px-4 py-2 text-center text-xs",
                      t.tableBorder,
                      isDark ? "bg-[#191f31]/60 text-[#bccbb9]" : "bg-slate-50 text-slate-500",
                    )}
                  >
                    No tasks due this week — use the arrows to find weeks with scheduled tasks.
                  </div>
                )}
                <div className="scrollbar-hide min-h-0 flex-1 overflow-x-auto overflow-y-auto sm:overflow-x-hidden">
                <motion.div
                  className={cn(
                    "grid h-full min-h-72 min-w-xl grid-cols-7 gap-px p-px",
                    "grid-rows-[minmax(18rem,1fr)] sm:min-h-88 sm:grid-rows-[minmax(22rem,1fr)] lg:min-h-104 lg:grid-rows-[minmax(26rem,1fr)]",
                    "sm:min-w-0",
                    isDark ? "bg-[#3d4a3d]/50" : "bg-slate-200",
                  )}
                >
                  {weekDays.map((date) => {
                    const key = toDateKey(date)
                    const dayTasks = tasksByDay.get(key) ?? []
                    const isToday = isSameDay(date, today)
                    const isSelected = selectedDay !== null && isSameDay(date, selectedDay)
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6

                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedDay(date)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setSelectedDay(date)
                          }
                        }}
                        className={cn(
                          "flex h-full min-h-0 flex-col overflow-hidden text-left transition-colors",
                          t.tableBg,
                          isWeekend && (isDark ? "bg-[#191f31]/90" : "bg-slate-50/90"),
                          isToday && (isDark ? "bg-[#4be277]/8" : "bg-blue-50/80"),
                          isSelected && (isDark ? "bg-[#4be277]/15" : "bg-blue-50"),
                          !isSelected && "cursor-pointer",
                          !isSelected && (isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50"),
                        )}
                      >
                        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden p-2">
                          {dayTasks.length === 0 ? (
                            <div className="flex flex-1 flex-col items-center justify-center py-8">
                              <span className={cn("text-[11px] font-medium", t.tableCellMuted)}>No tasks</span>
                            </div>
                          ) : (
                            dayTasks.map((task) => (
                              <TaskChip
                                key={task.id}
                                task={task}
                                member={task.assignedTo ? memberMap[task.assignedTo] ?? null : null}
                                isDark={isDark}
                                compact
                                onDoubleClick={(event) => onTaskPreview?.(task, event)}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </motion.div>
                </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {detailsOpen && (
            <motion.div
              key="day-details"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "flex max-h-[40vh] w-full shrink-0 flex-col border-t sm:max-h-none lg:max-h-none lg:w-72 lg:border-l lg:border-t-0",
                t.tableBorder,
                isDark ? "bg-[#191f31]/40" : "bg-slate-50/50",
              )}
            >
          <div className={cn("border-b px-4 py-3", t.tableBorder)}>
            <div className="flex items-center gap-2">
              <CalendarDays className={cn("h-4 w-4", isDark ? "text-[#4be277]" : "text-blue-500")} />
              <div>
                <p className={cn("text-xs font-medium uppercase tracking-wide", t.tableCellMuted)}>
                  Selected day
                </p>
                <p className={cn("text-sm font-semibold", t.tableCell)}>
                  {selectedDay
                    ? selectedDay.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "Pick a day"}
                </p>
              </div>
            </div>
          </div>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {selectedDay && selectedTasks.length === 0 && (
              <div className={cn("rounded-lg border border-dashed px-3 py-8 text-center text-sm", t.tableBorder, t.tableCellMuted)}>
                No tasks due on this day
              </div>
            )}
            {selectedTasks.map((task, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.2) }}
                onDoubleClick={(event) => onTaskPreview?.(task, event)}
                className={cn(
                  "cursor-pointer rounded-lg border p-3",
                  t.tableBorder,
                  isDark ? "bg-[#151b2d]" : "bg-white",
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className={cn("text-sm font-semibold leading-snug", task.completed ? cn("line-through", t.tableCellMuted) : t.tableCell)}>
                    {task.title}
                  </p>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full mt-1.5", PRIORITY_DOT[task.priority])} />
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium",
                      isDark ? STATUS_META[task.status].chipDark : STATUS_META[task.status].chipLight,
                    )}
                  >
                    {STATUS_META[task.status].icon}
                    {STATUS_META[task.status].label}
                  </span>
                  {task.assignedTo && memberMap[task.assignedTo] && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <MemberAvatar member={memberMap[task.assignedTo]!} isDark={isDark} />
                      <span className={cn("truncate text-[10px]", t.tableCellMuted)}>
                        {memberMap[task.assignedTo]!.name.split(" ")[0]}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {withoutDue.length > 0 && (
              <div className={cn("mt-2 rounded-lg border p-3", t.tableBorder, isDark ? "bg-[#0c1324]/60" : "bg-white")}>
                <p className={cn("mb-1 text-xs font-semibold", t.tableCellMuted)}>
                  {withoutDue.length} without due date
                </p>
                <p className={cn("text-[11px] leading-relaxed", t.tableCellMuted)}>
                  Set a due date in list or board view to show them on the calendar.
                </p>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className={cn("shrink-0 border-t px-3 py-2", t.tableBorder)}>
            <p className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-wider", t.tableCellMuted)}>Status</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_META) as TaskStatus[]).map((status) => (
                <span
                  key={status}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium",
                    isDark ? STATUS_META[status].chipDark : STATUS_META[status].chipLight,
                  )}
                >
                  {STATUS_META[status].icon}
                  {STATUS_META[status].label}
                </span>
              ))}
            </div>
          </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
