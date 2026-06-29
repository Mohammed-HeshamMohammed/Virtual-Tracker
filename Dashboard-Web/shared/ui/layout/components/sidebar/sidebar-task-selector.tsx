/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Clock, Check, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { getTasks } from "@/features/tasks/api/task-api"
import { readCache } from "@/shared/tables/hooks/list-cache-registry"
import { setTimerTask, getTimerTask, configureTimerStorageScope, type TimerTaskRef } from "@/features/activity/utils/timer-task-storage"
import { SIDEBAR_THEME_DARK as dark, SIDEBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"

interface SidebarTaskSelectorProps {
  isCollapsed: boolean
  selectedTaskForTimer: any
  setSelectedTaskForTimer: (task: any) => void
}

type CachedTask = {
  id: string
  title?: string
  status?: string
  assignedTo?: string | null
  assigned_to?: string | null
  assigneeIds?: string[]
  assignee_ids?: string[]
}

function openTasksForMember(tasks: CachedTask[], memberId: string): CachedTask[] {
  return tasks.filter((task) => {
    const status = task.status ?? "todo"
    if (status === "done") return false
    const assigneeIds = task.assigneeIds ?? task.assignee_ids ?? []
    if (Array.isArray(assigneeIds) && assigneeIds.includes(memberId)) return true
    const assignee = task.assignedTo ?? task.assigned_to ?? null
    return assignee === memberId
  })
}

export function SidebarTaskSelector({
  isCollapsed,
  selectedTaskForTimer,
  setSelectedTaskForTimer,
}: SidebarTaskSelectorProps) {
  const { isDark } = useTheme()
  const { memberId } = useAuth()
  const t = isDark ? dark : light

  const [taskSelectorOpen, setTaskSelectorOpen] = useState(false)
  const [assignedTasks, setAssignedTasks] = useState<any[]>([])
  const [assignedTasksReady, setAssignedTasksReady] = useState(false)
  const [tasksFetched, setTasksFetched] = useState(false)
  const taskSelectorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    configureTimerStorageScope(memberId)
  }, [memberId])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (taskSelectorRef.current && !taskSelectorRef.current.contains(e.target as Node)) {
        setTaskSelectorOpen(false)
      }
    }
    if (taskSelectorOpen) document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [taskSelectorOpen])

  useEffect(() => {
    if (!memberId) {
      setAssignedTasks([])
      setAssignedTasksReady(true)
      setTasksFetched(false)
      return
    }

    const cached = readCache<CachedTask[]>("pm-tasks:tasks")
    if (cached?.length) {
      setAssignedTasks(openTasksForMember(cached, memberId))
      setAssignedTasksReady(true)
      setTasksFetched(true)
      return
    }

    setAssignedTasks([])
    setAssignedTasksReady(true)
    setTasksFetched(false)
  }, [memberId])

  useEffect(() => {
    if (!taskSelectorOpen || !memberId || tasksFetched) return

    let cancelled = false
    setAssignedTasksReady(false)

    async function loadAssignedTasks() {
      try {
        const tasks = await getTasks({ assignedTo: memberId })
        if (cancelled) return
        setAssignedTasks(tasks.filter((task) => task.status !== "done"))
        setTasksFetched(true)
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch assigned tasks:", error)
          setAssignedTasks([])
          setTasksFetched(true)
        }
      } finally {
        if (!cancelled) setAssignedTasksReady(true)
      }
    }

    void loadAssignedTasks()
    return () => {
      cancelled = true
    }
  }, [taskSelectorOpen, memberId, tasksFetched])

  useEffect(() => {
    if (!assignedTasksReady || !tasksFetched) return

    if (!memberId) {
      if (selectedTaskForTimer || getTimerTask()) {
        setSelectedTaskForTimer(null)
        setTimerTask(null)
      }
      return
    }

    const stored = getTimerTask()
    const active = selectedTaskForTimer ?? stored
    if (!active) return

    const isStillAssigned = assignedTasks.some((task) => task.id === active.id)
    if (isStillAssigned) {
      if (!selectedTaskForTimer) {
        setSelectedTaskForTimer(active)
      }
      return
    }

    setSelectedTaskForTimer(null)
    setTimerTask(null)
  }, [assignedTasks, assignedTasksReady, tasksFetched, memberId, selectedTaskForTimer, setSelectedTaskForTimer])

  function selectTask(task: TimerTaskRef | null) {
    setSelectedTaskForTimer(task)
    setTimerTask(task)
  }

  return (
    <div ref={taskSelectorRef} className="relative">
      <button
        onClick={() => setTaskSelectorOpen(v => !v)}
        className={cn("relative w-full flex items-center justify-center py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.02] active:scale-95 overflow-hidden group", t.addTaskText)}
        style={{ background: `linear-gradient(135deg, ${t.addTaskFrom}, ${t.addTaskTo})` }} type="button"
      >
        <span className="absolute inset-0 bg-white opacity-0 group-hover:opacity-[0.12] transition-opacity duration-200 rounded-xl pointer-events-none" />
        <Clock className="w-4 h-4 shrink-0 relative z-10" />
        {!isCollapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="ml-2 whitespace-nowrap relative z-10">
            {selectedTaskForTimer ? selectedTaskForTimer.title : "Select Task"}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {taskSelectorOpen && !isCollapsed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={cn("absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden z-60 max-h-[300px] overflow-y-auto", t.userMenu)}
          >
            <div className={cn("p-1.5 space-y-0.5")}>
              {assignedTasks.length === 0 ? (
                <div className={cn("px-3 py-4 text-sm text-center", t.textMuted)}>
                  {!memberId ? "Member profile not linked yet" : "No open tasks assigned to you"}
                </div>
              ) : (
                <>
                  {selectedTaskForTimer && (
                    <button
                      onClick={() => {
                        selectTask(null)
                        setTaskSelectorOpen(false)
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                        t.contextItem
                      )} type="button"
                    >
                      <X className="w-4 h-4 shrink-0" />
                      <span className="flex-1">Clear Selection</span>
                    </button>
                  )}
                  {assignedTasks.map((task: any) => (
                    <button
                      key={task.id}
                      onClick={() => {
                        selectTask(task)
                        setTaskSelectorOpen(false)
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                        selectedTaskForTimer?.id === task.id ? t.themeActive : t.contextItem
                      )} type="button"
                    >
                      {selectedTaskForTimer?.id === task.id && <Check className="w-4 h-4 shrink-0" />}
                      <span className="flex-1 truncate">{task.title}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
