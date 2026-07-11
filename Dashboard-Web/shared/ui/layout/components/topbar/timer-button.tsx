/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Timer, Play, ChevronUp } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { useActivityRuntime } from "@/features/activity"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { subscribeTimerOpenPopup } from "@/features/activity/components/activity-runtime-bootstrap"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { AGENT_TIMER_BLOCKED_EVENT, getAgentTimerBlockMessage } from "@/features/activity/utils/agent-timer-gate"
import { TASK_TIMER_LIMIT_EVENT } from "@/features/activity/components/activity-tracking-context"
import { TIMER_LIMIT_REACHED_MESSAGE } from "@/features/activity/utils/timer-limit"
import { TimerTaskSelectionSync } from "@/features/activity/components/timer-task-selection-sync"
import { setTimerTask, type TimerTaskRef } from "@/features/activity/utils/timer-task-storage"
import { NotifyToastHost } from "@/shared/ui/layout/toasts/notify-toast-host"
import { PipTimerWidget } from "@/shared/ui/layout/components/topbar/pip-timer-widget"
import { useDocumentPip } from "@/shared/ui/layout/hooks/use-document-pip"

interface TimerButtonProps {
  isCollapsed?: boolean
  selectedTaskForTimer: any
}

export function TimerButton({ isCollapsed = false, selectedTaskForTimer }: TimerButtonProps) {
  const { active } = useActivityRuntime()
  if (!active) {
    return <TimerButtonIdle isCollapsed={isCollapsed} selectedTaskForTimer={selectedTaskForTimer} />
  }
  return <TimerButtonLive isCollapsed={isCollapsed} selectedTaskForTimer={selectedTaskForTimer} />
}

function TimerButtonIdle({ isCollapsed = false, selectedTaskForTimer }: TimerButtonProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { requestActivityRuntime } = useActivityRuntime()
  const { refreshAgentStatus } = useAgentStatus()
  const [pipNotice, setPipNotice] = useState<string | null>(null)

  useEffect(() => {
    function onAgentBlocked(e: Event) {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) setPipNotice(message)
    }
    window.addEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
    return () => window.removeEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
  }, [])

  async function handleTimerClick() {
    if (!selectedTaskForTimer) {
      setPipNotice("Please select a task from the sidebar before starting the timer.")
      return
    }

    const readiness = await refreshAgentStatus()
    if (!readiness.canStartTimer) {
      setPipNotice(getAgentTimerBlockMessage(readiness))
      return
    }

    const taskRef: TimerTaskRef = {
      id: selectedTaskForTimer.id,
      title: selectedTaskForTimer.title,
      durationHoursPerDay: selectedTaskForTimer.durationHoursPerDay ?? null,
      durationDays: selectedTaskForTimer.durationDays ?? null,
      overtimeHoursPerDay: selectedTaskForTimer.overtimeHoursPerDay ?? null,
      startDate: selectedTaskForTimer.startDate ?? null,
      dueDate: selectedTaskForTimer.dueDate ?? null,
      workingDays: selectedTaskForTimer.workingDays ?? null,
    }
    setTimerTask(taskRef)
    requestActivityRuntime({ action: "start", openPopup: true })
  }

  return (
    <>
      <div className="relative">
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleTimerClick}
          disabled={!selectedTaskForTimer}
          className={cn(
            "relative flex items-center font-bold text-sm text-white rounded-xl overflow-hidden transition-shadow",
            isCollapsed ? "p-2.5" : "gap-2 px-4 py-2",
            !selectedTaskForTimer && "cursor-not-allowed opacity-50",
            isDark ? "shadow-lg shadow-[#4be277]/20" : "shadow-lg shadow-green-600/20",
          )}
          style={{
            background: isDark
              ? "linear-gradient(135deg,#4be277,#22c55e)"
              : "linear-gradient(135deg,#006e2f,#22c55e)",
          }}
        >
          <Play className={cn("shrink-0 fill-white", isCollapsed ? "w-5 h-5 ml-0.5" : "w-4 h-4 ml-0.5")} />
          {!isCollapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className={cn("whitespace-nowrap", isDark ? "text-[#0c1324]" : "text-white")}
            >
              Start timer
            </motion.span>
          )}
        </motion.button>
      </div>

      <NotifyToastHost
        message={pipNotice}
        onDismiss={() => setPipNotice(null)}
        title="Timer"
        tone="error"
      />
    </>
  )
}

function TimerButtonLive({ isCollapsed = false, selectedTaskForTimer }: TimerButtonProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { phase, activeSeconds, idleSeconds, progressPercent, taskStatus, taskLimitSeconds, isTimerRunning, isAgentCapturing, startTracking, resumeTracking, toggleTimer, setCurrentTask } =
    useActivityTracking()
  const { canStartTimer, refreshAgentStatus } = useAgentStatus()

  const [showTimerTooltip, setShowTimerTooltip] = useState(false)
  const [pipNotice, setPipNotice] = useState<string | null>(null)

  const {
    showPopup,
    pipContainer,
    setPipNotice: setPipHookNotice,
    isTimerPopupOpen,
    openTimerPopup,
    closeTimerPopup,
  } = useDocumentPip()

  function showNotice(message: string) {
    setPipNotice(message)
    setPipHookNotice(message)
  }

  function fmt(s: number) {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = s % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  useEffect(() => {
    function onAgentBlocked(e: Event) {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) showNotice(message)
    }
    function onTimerLimit(e: Event) {
      const detail = (e as CustomEvent<{ message?: string }>).detail
      showNotice(detail?.message || TIMER_LIMIT_REACHED_MESSAGE)
    }
    window.addEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
    window.addEventListener(TASK_TIMER_LIMIT_EVENT, onTimerLimit)
    return () => {
      window.removeEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
      window.removeEventListener(TASK_TIMER_LIMIT_EVENT, onTimerLimit)
    }
  }, [])

  useEffect(() => subscribeTimerOpenPopup(() => void openTimerPopup()), [openTimerPopup])

  async function beginTimerSession(action: "start" | "resume"): Promise<boolean> {
    const ok = action === "start" ? await startTracking() : await resumeTracking()
    if (!ok) return false
    await openTimerPopup()
    return true
  }

  const tooltipKind =
    showTimerTooltip && !canStartTimer && (phase === "online" || phase === "idle")
      ? "agent-required"
      : showTimerTooltip && phase === "idle" && activeSeconds > 0
        ? "idle"
        : null

  async function handleTimerClick() {
    if (isTimerPopupOpen()) {
      closeTimerPopup()
      return
    }

    if (!selectedTaskForTimer) {
      showNotice("Please select a task from the sidebar before starting the timer.")
      return
    }

    const taskRef: TimerTaskRef = {
      id: selectedTaskForTimer.id,
      title: selectedTaskForTimer.title,
      durationHoursPerDay: selectedTaskForTimer.durationHoursPerDay ?? null,
      durationDays: selectedTaskForTimer.durationDays ?? null,
      overtimeHoursPerDay: selectedTaskForTimer.overtimeHoursPerDay ?? null,
      startDate: selectedTaskForTimer.startDate ?? null,
      dueDate: selectedTaskForTimer.dueDate ?? null,
      workingDays: selectedTaskForTimer.workingDays ?? null,
    }
    setTimerTask(taskRef)
    setCurrentTask(taskRef)

    if (phase === "online" || phase === "idle") {
      const readiness = await refreshAgentStatus()
      if (!readiness.canStartTimer) {
        showNotice(getAgentTimerBlockMessage(readiness))
        return
      }

      const started = await beginTimerSession(phase === "online" ? "start" : "resume")
      if (!started) {
        const after = await refreshAgentStatus()
        showNotice(getAgentTimerBlockMessage(after))
      }
      return
    }

    await openTimerPopup()
  }

  return (
    <>
      <TimerTaskSelectionSync selectedTaskForTimer={selectedTaskForTimer} />
      <div
        className="relative"
        onMouseEnter={() => setShowTimerTooltip(true)}
        onMouseLeave={() => setShowTimerTooltip(false)}
      >
        <AnimatePresence mode="wait">
          {tooltipKind === "idle" && (
            <motion.div
              key="timer-tooltip-idle"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute top-full mt-2 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg z-50 pointer-events-none",
                t.timerTooltip,
              )}
            >
              Idle · {fmt(activeSeconds)}
              <span
                className={cn(
                  "absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent",
                  t.timerArrow,
                )}
              />
            </motion.div>
          )}
          {tooltipKind === "agent-required" && (
            <motion.div
              key="timer-tooltip-agent"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg z-50 pointer-events-none max-w-[220px] text-center",
                t.timerTooltip,
              )}
            >
              Agent required — run Python-App-Extension
              <span
                className={cn(
                  "absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent",
                  t.timerArrow,
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleTimerClick}
          disabled={!isTimerRunning && !selectedTaskForTimer}
          className={cn(
            "relative flex items-center font-bold text-sm text-white rounded-xl overflow-hidden transition-shadow",
            isCollapsed ? "p-2.5" : "gap-2 px-4 py-2",
            !isTimerRunning && !canStartTimer && selectedTaskForTimer && "opacity-70",
            !isTimerRunning && !selectedTaskForTimer && "cursor-not-allowed opacity-50",
            isTimerRunning
              ? "bg-green-600 shadow-lg shadow-green-600/30 hover:bg-green-700"
              : isDark
                ? "shadow-lg shadow-[#4be277]/20"
                : "shadow-lg shadow-green-600/20",
          )}
          style={
            !isTimerRunning
              ? {
                  background: isDark
                    ? "linear-gradient(135deg,#4be277,#22c55e)"
                    : "linear-gradient(135deg,#006e2f,#22c55e)",
                }
              : undefined
          }
        >
          {isTimerRunning && !isCollapsed && (
            <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse shrink-0" />
          )}
          {isAgentCapturing && !isCollapsed && (
            <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              Agent
            </span>
          )}
          {isTimerRunning ? (
            <Timer className={cn("shrink-0", isCollapsed ? "w-5 h-5" : "w-4 h-4")} />
          ) : (
            <Play className={cn("shrink-0 fill-white", isCollapsed ? "w-5 h-5 ml-0.5" : "w-4 h-4 ml-0.5")} />
          )}
          {!isCollapsed && (
            <motion.span
              key={isTimerRunning ? "running" : phase === "idle" ? "resume" : "start"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className={cn("whitespace-nowrap", isTimerRunning ? "" : isDark ? "text-[#0c1324]" : "text-white")}
            >
              {isTimerRunning ? fmt(activeSeconds) : phase === "idle" ? "Resume timer" : "Start timer"}
            </motion.span>
          )}
          {!isCollapsed && isTimerRunning && (
            <motion.div animate={{ rotate: showPopup ? 180 : 0 }} transition={{ duration: 0.18 }} className="shrink-0">
              <ChevronUp className="w-3.5 h-3.5 text-white/70" />
            </motion.div>
          )}
        </motion.button>
      </div>

      {pipContainer &&
        createPortal(
          <PipTimerWidget
            activeSeconds={activeSeconds}
            idleSeconds={idleSeconds}
            progressPercent={progressPercent}
            plannedSeconds={taskLimitSeconds}
            taskStatus={taskStatus}
            isTimerRunning={isTimerRunning}
            isDark={isDark}
            onToggle={() => void toggleTimer()}
            onClose={closeTimerPopup}
            taskName={selectedTaskForTimer?.title || "VirtualTracker OS Dashboard"}
          />,
          pipContainer,
        )}

      <NotifyToastHost message={pipNotice} onDismiss={() => setPipNotice(null)} title="Timer" tone="error" />
    </>
  )
}
