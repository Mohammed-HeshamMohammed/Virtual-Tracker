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

type TaskStatus = OverviewTaskCard["status"]

const STATUS_CONFIG = {
  todo: { label: "To do", color: "text-slate-500", bg: "bg-slate-100", icon: <Circle className="w-3 h-3" /> },
  in_progress: { label: "In Progress", color: "text-blue-600", bg: "bg-blue-50", icon: <Clock className="w-3 h-3" /> },
  in_review: { label: "In Review", color: "text-amber-600", bg: "bg-amber-50", icon: <AlertCircle className="w-3 h-3" /> },
  blocked: { label: "Blocked", color: "text-red-600", bg: "bg-red-50", icon: <Ban className="w-3 h-3" /> },
  done: { label: "Done", color: "text-emerald-600", bg: "bg-emerald-50", icon: <CheckCircle2 className="w-3 h-3" /> },
}

const PRIORITY_COLORS = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-amber-600",
  urgent: "text-red-500",
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
  const [activeStatus, setActiveStatus] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<OverviewTaskCard | null>(null)

  const grouped = useMemo(() => {
    const g: Record<string, OverviewTaskCard[]> = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] }
    tasks.forEach((t) => g[t.status]?.push(t))
    return g
  }, [tasks])
  const filteredTasks = useMemo(
    () => tasks.filter((t) => !activeStatus || t.status === activeStatus),
    [tasks, activeStatus],
  )

  const visibleTasks = useMemo(() => filteredTasks.slice(0, MAX_TASKS_BREAKDOWN), [filteredTasks])

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border shadow-sm",
        TASK_PANEL_HEIGHT_CLASS,
        isDark ? "bg-[#0c1324] border-[#3d4a3d]/40" : "bg-white border-slate-100",
        className,
      )}
    >
      <div className={cn("flex items-center justify-between px-6 py-4 border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className={cn("w-4 h-4", isDark ? "text-[#dce1fb]/50" : "text-slate-400")} />
          <h3 className={cn("text-sm font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Tasks Breakdown</h3>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", isDark ? "bg-[#2e3447] text-[#dce1fb]/70" : "bg-slate-100 text-slate-500")}>
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
                  className={cn(
                    "flex shrink-0 items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all",
                    isActive
                      ? `${cfg.bg} ${cfg.color}`
                      : isDark
                      ? "bg-[#2e3447] text-[#dce1fb]/50 hover:bg-[#3d4a3d]/40"
                      : "bg-slate-100 text-slate-400 hover:bg-slate-200",
                  )} type="button"
                >
                  {cfg.icon}
                  {grouped[s]?.length || 0}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => onNavigate?.("pm-tasks")}
            className="text-xs text-green-700 font-semibold hover:underline flex items-center gap-1" type="button"
          >
            View all <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-4 md:grid-cols-2">
        <AnimatePresence>
          {filteredTasks.length === 0 ? (
            <div className="col-span-1 md:col-span-2 flex flex-1 flex-col items-center justify-center px-6 py-12">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", isDark ? "bg-[#191f31]" : "bg-slate-100")}>
                <CheckCircle2 className={cn("w-6 h-6", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
              </div>
              <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                {activeStatus ? `No ${activeStatus.replace("_", " ")} tasks` : "No tasks found"}
              </p>
              <p className={cn("text-xs text-slate-400 mt-1")}>
                {activeStatus ? "Try selecting a different status" : "Create tasks to track project progress"}
              </p>
            </div>
          ) : (
            visibleTasks.map((task, i) => {
              const sCfg = STATUS_CONFIG[task.status]
              const pColor = PRIORITY_COLORS[task.priority]
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
                    isDark ? "hover:bg-[#2e3447] hover:border-[#3d4a3d]/40" : "hover:bg-slate-50 hover:border-slate-100",
                  )}
                >
                  <span className={cn("mt-0.5", sCfg.color)}>{sCfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        task.status === "done" ? "line-through text-slate-400" : isDark ? "text-[#dce1fb]" : "text-slate-700",
                      )}
                    >
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400 truncate">{projectName}</span>
                      <span className="text-slate-200">·</span>
                      <span className={cn("text-[10px] font-semibold", pColor)}>{task.priority}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">{assigneeName}</span>
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
              className={cn(
                "w-full max-w-lg rounded-2xl shadow-xl overflow-hidden",
                isDark ? "bg-[#0c1324] border border-[#3d4a3d]/40" : "bg-white border border-slate-200",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn("flex items-center justify-between px-6 py-4 border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                <div className="flex items-center gap-2">
                  {STATUS_CONFIG[selectedTask.status]?.icon}
                  <h3 className={cn("text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Task Details</h3>
                </div>
                <button
                  onClick={() => setSelectedTask(null)}
                  className={cn("p-1 rounded-lg transition-colors", isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100")} type="button"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block" htmlFor="fallback-id">Title</label>
                  <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{selectedTask.title}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">Status</label>
                    <span className={cn("text-xs font-bold px-2 py-1 rounded-full", STATUS_CONFIG[selectedTask.status]?.color, STATUS_CONFIG[selectedTask.status]?.bg)}>
                      {STATUS_CONFIG[selectedTask.status]?.label}
                    </span>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">Priority</label>
                    <span className={cn("text-xs font-semibold", PRIORITY_COLORS[selectedTask.priority])}>{selectedTask.priority}</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">Project</label>
                  <p className={cn("text-sm", isDark ? "text-[#dce1fb]/80" : "text-slate-600")}>{projectNames[selectedTask.projectId] || "Unknown"}</p>
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">Assigned To</label>
                  <p className={cn("text-sm", isDark ? "text-[#dce1fb]/80" : "text-slate-600")}>
                    {selectedTask.assignedTo ? assigneeNames[selectedTask.assignedTo] || "Unknown" : "Unassigned"}
                  </p>
                </div>
              </div>

              <div className={cn("flex justify-end px-6 py-4 border-t", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                <button
                  onClick={() => {
                    setSelectedTask(null)
                    onNavigate?.("pm-tasks")
                  }}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                    isDark ? "bg-[#4be277] text-[#0c1324] hover:bg-[#4be277]/90" : "bg-green-600 text-white hover:bg-green-700",
                  )} type="button"
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
