"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Circle,
  ExternalLink,
  Ban,
  X,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewTaskCard } from "@/features/projects/mappers/project-mapper"
import { MAX_TASKS_BREAKDOWN, TASK_PANEL_HEIGHT_CLASS } from "@/features/projects/constants/project-constants"
import { overviewTheme, type Tone } from "@/features/projects/components/overview/overview-theme"

type TaskStatus = OverviewTaskCard["status"]

const STATUS_CONFIG: Record<TaskStatus, { label: string; tone: Tone; icon: React.ReactNode }> = {
  todo: { label: "To do", tone: "neutral", icon: <Circle className="w-3 h-3" /> },
  in_progress: { label: "In Progress", tone: "info", icon: <Clock className="w-3 h-3" /> },
  in_review: { label: "In Review", tone: "warning", icon: <AlertCircle className="w-3 h-3" /> },
  blocked: { label: "Blocked", tone: "danger", icon: <Ban className="w-3 h-3" /> },
  done: { label: "Done", tone: "success", icon: <CheckCircle2 className="w-3 h-3" /> },
}

interface TasksBreakdownProps {
  tasks: OverviewTaskCard[]
  projectNames: Record<string, string>
  assigneeNames: Record<string, string>
  isDark?: boolean
  onNavigate?: (id: string) => void
  className?: string
}
const statusKeys: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done"]

export function TasksBreakdown({
  tasks,
  projectNames,
  assigneeNames,
  isDark = false,
  onNavigate,
  className,
}: TasksBreakdownProps) {
  const t = overviewTheme(isDark)
  const [activeStatus, setActiveStatus] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<OverviewTaskCard | null>(null)

  const grouped = useMemo(() => {
    const g: Record<string, OverviewTaskCard[]> = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] }
    tasks.forEach((task) => g[task.status]?.push(task))
    return g
  }, [tasks])
  const filteredTasks = useMemo(
    () => tasks.filter((task) => !activeStatus || task.status === activeStatus),
    [tasks, activeStatus],
  )

  const visibleTasks = useMemo(() => filteredTasks.slice(0, MAX_TASKS_BREAKDOWN), [filteredTasks])
  const label = cn("text-[10px] font-semibold uppercase tracking-wider mb-1 block", t.muted)

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm", TASK_PANEL_HEIGHT_CLASS, t.card, className)}>
      <div className={cn("flex items-center justify-between px-6 py-4 border-b", t.border)}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className={cn("w-4 h-4", t.icon)} />
          <h3 className={cn("text-sm font-bold", t.title)}>Tasks Breakdown</h3>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold tabular-nums", t.countPill)}>
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden">
            {statusKeys.filter((s) => (grouped[s]?.length || 0) > 0).map((s) => {
              const cfg = STATUS_CONFIG[s]
              const isActive = activeStatus === s
              return (
                <button
                  key={s}
                  onClick={() => setActiveStatus(isActive ? null : s)}
                  aria-pressed={isActive}
                  title={cfg.label}
                  className={cn(
                    "flex shrink-0 items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all tabular-nums",
                    isActive ? t.badge[cfg.tone] : t.inactiveChip,
                  )}
                  type="button"
                >
                  {cfg.icon}
                  {grouped[s]?.length || 0}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => onNavigate?.("pm-tasks")}
            className={cn("text-xs font-semibold hover:underline flex items-center gap-1", t.link)}
            type="button"
          >
            View all <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-4 md:grid-cols-2">
        <AnimatePresence>
          {filteredTasks.length === 0 ? (
            <div className="col-span-1 md:col-span-2 flex flex-1 flex-col items-center justify-center px-6 py-12">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", t.emptyIconWrap)}>
                <CheckCircle2 className={cn("w-6 h-6", t.emptyIcon)} />
              </div>
              <p className={cn("text-sm font-medium", t.text)}>
                {activeStatus ? `No ${activeStatus.replace("_", " ")} tasks` : "No tasks found"}
              </p>
              <p className={cn("text-xs mt-1", t.muted)}>
                {activeStatus ? "Try selecting a different status" : "Create tasks to track project progress"}
              </p>
            </div>
          ) : (
            visibleTasks.map((task, i) => {
              const sCfg = STATUS_CONFIG[task.status]
              const projectName = projectNames[task.projectId] || "Unknown"
              const assigneeName = task.assignedTo ? assigneeNames[task.assignedTo] || "Unknown" : "Unassigned"
              return (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => setSelectedTask(task)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl transition-colors group border border-transparent cursor-pointer",
                    t.hoverCard,
                  )}
                >
                  <span className={cn("mt-0.5", t.toneText[sCfg.tone])}>{sCfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", task.status === "done" ? cn("line-through", t.muted) : t.text)}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("text-[10px] truncate", t.muted)}>{projectName}</span>
                      <span className={t.muted} aria-hidden>·</span>
                      <span className={cn("text-[10px] font-semibold", t.priority[task.priority])}>{task.priority}</span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] shrink-0 mt-0.5", t.muted)}>{assigneeName}</span>
                </motion.div>
              )
            })
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setSelectedTask(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className={cn("w-full max-w-lg rounded-2xl shadow-xl overflow-hidden", t.modal)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn("flex items-center justify-between px-6 py-4 border-b", t.border)}>
                <div className="flex items-center gap-2">
                  <span className={t.toneText[STATUS_CONFIG[selectedTask.status].tone]}>
                    {STATUS_CONFIG[selectedTask.status]?.icon}
                  </span>
                  <h3 className={cn("text-lg font-bold", t.title)}>Task Details</h3>
                </div>
                <button
                  onClick={() => setSelectedTask(null)}
                  aria-label="Close"
                  className={cn("p-1 rounded-lg transition-colors", t.closeHover)}
                  type="button"
                >
                  <X className={cn("w-5 h-5", t.icon)} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <span className={label}>Title</span>
                  <p className={cn("text-sm font-medium", t.text)}>{selectedTask.title}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <span className={label}>Status</span>
                    <span className={cn("text-xs font-bold px-2 py-1 rounded-full", t.badge[STATUS_CONFIG[selectedTask.status].tone])}>
                      {STATUS_CONFIG[selectedTask.status]?.label}
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className={label}>Priority</span>
                    <span className={cn("text-xs font-semibold", t.priority[selectedTask.priority])}>{selectedTask.priority}</span>
                  </div>
                </div>

                <div>
                  <span className={label}>Project</span>
                  <p className={cn("text-sm", t.secondary)}>{projectNames[selectedTask.projectId] || "Unknown"}</p>
                </div>

                <div>
                  <span className={label}>Assigned To</span>
                  <p className={cn("text-sm", t.secondary)}>
                    {selectedTask.assignedTo ? assigneeNames[selectedTask.assignedTo] || "Unknown" : "Unassigned"}
                  </p>
                </div>
              </div>

              <div className={cn("flex justify-end px-6 py-4 border-t", t.border)}>
                <button
                  onClick={() => {
                    setSelectedTask(null)
                    onNavigate?.("pm-tasks")
                  }}
                  className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors", t.primaryButton)}
                  type="button"
                >
                  View in Tasks
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
