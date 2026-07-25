/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Timer, Play, Clock } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { useActivityRuntime } from "@/features/activity"
import { fetchActivitySession } from "@/features/activity/services/activity-api"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { AGENT_TIMER_BLOCKED_EVENT } from "@/features/activity/utils/agent-timer-gate"
import { TASK_TIMER_LIMIT_EVENT } from "@/features/activity/components/activity-tracking-context"
import { TIMER_LIMIT_REACHED_MESSAGE } from "@/features/activity/utils/timer-limit"
import { NotifyToastHost } from "@/shared/ui/layout/toasts/notify-toast-host"
import type { NavigateHandler } from "@/app/routes/types"

/** How often to check for a session the desktop agent already started. */
const EXTERNAL_SESSION_POLL_MS = 8_000

interface TimerButtonProps {
  isCollapsed?: boolean
  onNavigate: NavigateHandler
}

/** The Tauri agent is the only thing that starts, stops, or shows detail for a
 * tracking session — this button is a read-only mirror of agent+backend state. */
export function TimerButton({ isCollapsed = false, onNavigate }: TimerButtonProps) {
  const { active } = useActivityRuntime()
  if (!active) {
    return <TimerButtonIdle isCollapsed={isCollapsed} onNavigate={onNavigate} />
  }
  return <TimerButtonLive isCollapsed={isCollapsed} />
}

/** Idle: task selection and starting both happen in the desktop agent now — this
 * button only detects an agent-started session and reflects it (or points at the
 * agent/backend when it can't). It never starts anything itself. */
function TimerButtonIdle({ isCollapsed = false, onNavigate }: TimerButtonProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { requestActivityRuntime } = useActivityRuntime()
  const { isLocalAgentRunning, refreshAgentStatus } = useAgentStatus()
  const [notice, setNotice] = useState<string | null>(null)
  const [showAgentTooltip, setShowAgentTooltip] = useState(false)

  useEffect(() => {
    void refreshAgentStatus()
  }, [refreshAgentStatus])

  useEffect(() => {
    if (!isLocalAgentRunning) return
    let cancelled = false
    async function checkForExternalSession() {
      const session = await fetchActivitySession()
      if (cancelled || !session) return
      if (session.status === "active" || session.status === "idle") {
        requestActivityRuntime({ action: "adopt" })
      }
    }
    void checkForExternalSession()
    const interval = setInterval(() => void checkForExternalSession(), EXTERNAL_SESSION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isLocalAgentRunning, requestActivityRuntime])

  useEffect(() => {
    function onAgentBlocked(e: Event) {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) setNotice(message)
    }
    window.addEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
    return () => window.removeEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
  }, [])

  const agentMissing = !isLocalAgentRunning

  function handleTimerClick() {
    if (agentMissing) {
      onNavigate("activity-tools")
      return
    }
    // Agent is connected but hasn't started tracking — nothing to trigger from
    // here, starting only happens in the agent's own UI.
    setNotice("Open the Virtual Tracker Agent on your computer to start tracking.")
  }

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setShowAgentTooltip(true)}
        onMouseLeave={() => setShowAgentTooltip(false)}
      >
        <AnimatePresence>
          {showAgentTooltip && agentMissing && (
            <motion.div
              key="timer-tooltip-agent-idle"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute top-full mt-2 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg z-50 pointer-events-none max-w-[220px] text-center",
                t.timerTooltip,
              )}
            >
              Download the Tracker Agent to start tracking from the web
              <span
                className={cn(
                  "absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent",
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
          className={cn(
            "relative flex items-center font-bold text-sm text-white rounded-xl overflow-hidden transition-shadow",
            isCollapsed ? "p-2.5" : "gap-2 px-4 py-2",
            agentMissing && "opacity-70",
            isDark ? "shadow-lg shadow-[#4be277]/20" : "shadow-lg shadow-green-600/20",
          )}
          style={{
            background: isDark
              ? "linear-gradient(135deg,#4be277,#22c55e)"
              : "linear-gradient(135deg,#006e2f,#22c55e)",
          }}
        >
          {agentMissing ? (
            <Play className={cn("shrink-0 fill-white", isCollapsed ? "w-5 h-5 ml-0.5" : "w-4 h-4 ml-0.5")} />
          ) : (
            <Clock className={cn("shrink-0", isCollapsed ? "w-5 h-5" : "w-4 h-4")} />
          )}
          {!isCollapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className={cn("whitespace-nowrap", isDark ? "text-[#0c1324]" : "text-white")}
            >
              {agentMissing ? "Start Now" : "Agent ready"}
            </motion.span>
          )}
        </motion.button>
      </div>

      <NotifyToastHost message={notice} onDismiss={() => setNotice(null)} title="Timer" tone="error" />
    </>
  )
}

/** Live: a session exists (adopted from the agent). Pure read-only reflection —
 * no popup, no stop/start controls. Those live in the Tauri app now. */
function TimerButtonLive({ isCollapsed = false }: Pick<TimerButtonProps, "isCollapsed">) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { phase, activeSeconds, isTimerRunning, isAgentCapturing } = useActivityTracking()

  const [showTimerTooltip, setShowTimerTooltip] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function fmt(s: number) {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = s % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  useEffect(() => {
    function onAgentBlocked(e: Event) {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) setNotice(message)
    }
    function onTimerLimit(e: Event) {
      const detail = (e as CustomEvent<{ message?: string }>).detail
      setNotice(detail?.message || TIMER_LIMIT_REACHED_MESSAGE)
    }
    window.addEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
    window.addEventListener(TASK_TIMER_LIMIT_EVENT, onTimerLimit)
    return () => {
      window.removeEventListener(AGENT_TIMER_BLOCKED_EVENT, onAgentBlocked)
      window.removeEventListener(TASK_TIMER_LIMIT_EVENT, onTimerLimit)
    }
  }, [])

  const tooltipKind = showTimerTooltip && phase === "idle" && activeSeconds > 0 ? "idle" : null

  function handleTimerClick() {
    setNotice("Manage tracking from the Virtual Tracker Agent on your computer.")
  }

  return (
    <>
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
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleTimerClick}
          className={cn(
            "relative flex items-center font-bold text-sm text-white rounded-xl overflow-hidden transition-shadow",
            isCollapsed ? "p-2.5" : "gap-2 px-4 py-2",
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
              {isTimerRunning ? fmt(activeSeconds) : phase === "idle" ? "Paused" : "Start timer"}
            </motion.span>
          )}
        </motion.button>
      </div>

      <NotifyToastHost message={notice} onDismiss={() => setNotice(null)} title="Timer" tone="error" />
    </>
  )
}
