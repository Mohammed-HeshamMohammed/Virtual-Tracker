"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useAuth } from "@/shared/providers/app"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { fetchActivitySession, postActivitySession, postActivitySessionDetailed } from "@/features/activity/services/activity-api"
import { fetchTaskTimeTracking, syncTaskTimeTrackingApi } from "@/features/tasks/api/task-time-tracking-api"
import { ACTIVITY_SESSION_SYNC_MS } from "@/infrastructure/config/firestore-throttle"
import { startIdleWatch } from "@/features/activity/utils/idle-detector"
import { acquireWakeLock, bindWakeLockVisibility, releaseWakeLock } from "@/features/activity/utils/wake-lock"
import {
  getAgentTimerBlockMessage,
  notifyAgentTimerBlocked,
} from "@/features/activity/utils/agent-timer-gate"
import {
  getTaskTimerLimitSeconds,
  getTaskTimerState,
  applyBackendTaskTimerState,
  setTaskTimerState,
  configureTimerStorageScope,
  clearAllTaskTimerStateForScope,
  type TimerTaskRef,
} from "@/features/activity/utils/timer-task-storage"
import {
  TIMER_LIMIT_REACHED_MESSAGE,
  resolveTimerActiveLimit,
  type TimerAllowance,
} from "@/features/activity/utils/timer-limit"

export type TrackingPhase = "online" | "active" | "idle"

interface ActivityTrackingContextValue {
  phase: TrackingPhase
  activeSeconds: number
  idleSeconds: number
  progressPercent: number | null
  taskStatus: string | null
  isTimerRunning: boolean
  sessionId: string | null
  isAgentCapturing: boolean
  currentTask: TimerTaskRef | null
  taskLimitSeconds: number | null
  setCurrentTask: (task: TimerTaskRef | null) => void
  canStartTimer: boolean
  startTracking: () => Promise<boolean>
  /** Passively reflect whatever session already exists (e.g. one the desktop agent started) without POSTing a new one. */
  restoreSession: () => Promise<void>
  setIdle: () => Promise<void>
  resumeTracking: () => Promise<boolean>
  stopTracking: () => Promise<void>
  toggleTimer: () => Promise<boolean>
}

const ActivityTrackingContext = createContext<ActivityTrackingContextValue | undefined>(undefined)

const SYNC_MS = ACTIVITY_SESSION_SYNC_MS
const SESSION_POLL_MS = 5_000
const AGENT_CHECK_MS = 5_000
/** Pause immediately when the agent is unavailable in desktop capture mode. */
const AGENT_FAIL_PAUSE_THRESHOLD = 1
/** Consecutive missing session polls before treating the session as ended. */
const SESSION_MISS_STOP_THRESHOLD = 3
const STORAGE_KEY = "vt-activity-session"
const LIMIT_EVENT = "vt-task-timer-limit-reached"

function pingActivityFeeds() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("vt-activity-ping"))
  }
}

function notifyTaskLimitReached(taskTitle: string, message?: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(LIMIT_EVENT, {
      detail: { taskTitle, message: message ?? TIMER_LIMIT_REACHED_MESSAGE },
    }),
  )
}

export function useActivityTracking() {
  const ctx = useContext(ActivityTrackingContext)
  if (!ctx) throw new Error("useActivityTracking must be used within ActivityTrackingProvider")
  return ctx
}

function applyTaskTimerToRefs(
  taskId: string,
  activeRef: React.MutableRefObject<number>,
  idleRef: React.MutableRefObject<number>,
  setActiveSeconds: (v: number) => void,
  setIdleSeconds: (v: number) => void,
) {
  const state = getTaskTimerState(taskId)
  activeRef.current = state.activeSeconds
  idleRef.current = state.idleSeconds
  setActiveSeconds(state.activeSeconds)
  setIdleSeconds(state.idleSeconds)
}

/** Task timer backed by activity_sessions. Desktop/Python agent captures while session is active. */
export function ActivityTrackingProvider({
  children,
  deferInitialSessionRestore = false,
}: {
  children: ReactNode
  /** When true, do not call GET /api/activity/session until the user starts a timer. */
  deferInitialSessionRestore?: boolean
}) {
  const { isLoggedIn, user, profile, sessionReady, memberId } = useAuth()
  const { isAgentMode, isLocalAgentRunning, canStartTimer, refreshAgentStatus } = useAgentStatus()
  const [phase, setPhase] = useState<TrackingPhase>("online")
  const [activeSeconds, setActiveSeconds] = useState(0)
  const [idleSeconds, setIdleSeconds] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentTask, setCurrentTaskState] = useState<TimerTaskRef | null>(null)
  const [taskLimitSeconds, setTaskLimitSeconds] = useState<number | null>(null)
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const phaseRef = useRef<TrackingPhase>("online")
  const activeRef = useRef(0)
  const idleRef = useRef(0)
  const sessionRef = useRef<string | null>(null)
  const currentTaskRef = useRef<TimerTaskRef | null>(null)
  const taskLimitRef = useRef<number | null>(null)
  const limitHandlingRef = useRef(false)
  const timerAllowanceRef = useRef<TimerAllowance | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const authReadyRef = useRef(false)
  const timersBootstrappedRef = useRef(false)
  const agentFailStreakRef = useRef(0)
  const sessionMissStreakRef = useRef(0)

  authReadyRef.current =
    Boolean(isLoggedIn && sessionReady && user && !profile?.mustChangePassword)

  useEffect(() => {
    configureTimerStorageScope(memberId)
    if (!memberId) {
      clearAllTaskTimerStateForScope()
      currentTaskRef.current = null
      setCurrentTaskState(null)
      activeRef.current = 0
      idleRef.current = 0
      setActiveSeconds(0)
      setIdleSeconds(0)
      setProgressPercent(null)
      setTaskStatus(null)
    }
  }, [memberId])

  const applyTrackingSnapshot = useCallback(
    (state: {
      activeSeconds: number
      idleSeconds: number
      progressPercent?: number | null
      taskStatus?: string | null
    }) => {
      activeRef.current = state.activeSeconds
      idleRef.current = state.idleSeconds
      setActiveSeconds(state.activeSeconds)
      setIdleSeconds(state.idleSeconds)
      setProgressPercent(state.progressPercent ?? null)
      setTaskStatus(state.taskStatus ?? null)
    },
    [],
  )

  const persistCurrentTaskTimer = useCallback(() => {
    const taskId = currentTaskRef.current?.id
    if (!taskId) return
    setTaskTimerState(taskId, {
      activeSeconds: activeRef.current,
      idleSeconds: idleRef.current,
    })
  }, [])

  const sessionCounters = useCallback(() => {
    return {
      activeSeconds: activeRef.current,
      idleSeconds: idleRef.current,
      taskId: currentTaskRef.current?.id ?? null,
    }
  }, [])

  const applyTimerAllowance = useCallback((task: TimerTaskRef | null, allowance?: TimerAllowance | null) => {
    timerAllowanceRef.current = allowance ?? null
    const fallback = getTaskTimerLimitSeconds(task)
    const limit = resolveTimerActiveLimit(allowance, fallback)
    taskLimitRef.current = limit
    setTaskLimitSeconds(limit)
  }, [])

  const syncTaskTracking = useCallback(
    async (action: "start" | "idle" | "resume" | "stop" | "sync") => {
      if (!authReadyRef.current) return null
      const taskId = currentTaskRef.current?.id
      if (!taskId) return null
      const result = await syncTaskTimeTrackingApi(taskId, action, {
        activeSeconds: activeRef.current,
        idleSeconds: idleRef.current,
        sessionId: sessionRef.current,
      })
      if (result?.timerAllowance) {
        applyTimerAllowance(currentTaskRef.current, result.timerAllowance)
      }
      if (result) {
        const preferLocalIfHigher = phaseRef.current === "active" || phaseRef.current === "idle"
        const nextActive = preferLocalIfHigher
          ? Math.max(activeRef.current, result.activeSeconds)
          : result.activeSeconds
        const nextIdle = preferLocalIfHigher
          ? Math.max(idleRef.current, result.idleSeconds)
          : result.idleSeconds
        if (nextActive !== activeRef.current || nextIdle !== idleRef.current) {
          activeRef.current = nextActive
          idleRef.current = nextIdle
          setActiveSeconds(nextActive)
          setIdleSeconds(nextIdle)
          persistCurrentTaskTimer()
        }
        setProgressPercent(result.progressPercent ?? null)
        setTaskStatus(result.taskStatus ?? null)
      }
      return result
    },
    [applyTimerAllowance, persistCurrentTaskTimer],
  )

  const loadTaskFromBackend = useCallback(async (taskId: string) => {
    if (!authReadyRef.current) return
    const state = await fetchTaskTimeTracking(taskId)
    if (!state || currentTaskRef.current?.id !== taskId) return
    const preferLocalIfHigher = phaseRef.current === "active" || phaseRef.current === "idle"
    const merged = applyBackendTaskTimerState(
      taskId,
      {
        activeSeconds: state.activeSeconds,
        idleSeconds: state.idleSeconds,
      },
      { preferLocalIfHigher },
    )
    applyTrackingSnapshot({
      activeSeconds: merged.activeSeconds,
      idleSeconds: merged.idleSeconds,
      progressPercent: state.progressPercent,
      taskStatus: state.taskStatus,
    })
    applyTimerAllowance(currentTaskRef.current, state.timerAllowance)
  }, [applyTimerAllowance, applyTrackingSnapshot])

  const applyPhase = useCallback((p: TrackingPhase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const syncSession = useCallback(async () => {
    if (!sessionRef.current) return
    const counters = sessionCounters()
    await postActivitySession("sync", counters)
    await syncTaskTracking("sync")
  }, [sessionCounters, syncTaskTracking])

  const setCurrentTask = useCallback(
    (task: TimerTaskRef | null) => {
      const prevId = currentTaskRef.current?.id
      const nextId = task?.id ?? null

      if (prevId === nextId) {
        if (task) {
          currentTaskRef.current = task
          setCurrentTaskState(task)
        }
        return
      }

      if (prevId && prevId !== nextId) {
        setTaskTimerState(prevId, {
          activeSeconds: activeRef.current,
          idleSeconds: idleRef.current,
        })
        if (authReadyRef.current) {
          void syncTaskTimeTrackingApi(prevId, "sync", {
            activeSeconds: activeRef.current,
            idleSeconds: idleRef.current,
            sessionId: sessionRef.current,
          })
        }
      }

      currentTaskRef.current = task
      setCurrentTaskState(task)
      applyTimerAllowance(task, null)

      if (nextId) {
        applyTaskTimerToRefs(nextId, activeRef, idleRef, setActiveSeconds, setIdleSeconds)
        setProgressPercent(null)
        setTaskStatus(null)
        void loadTaskFromBackend(nextId)
      } else {
        activeRef.current = 0
        idleRef.current = 0
        setActiveSeconds(0)
        setIdleSeconds(0)
        setProgressPercent(null)
        setTaskStatus(null)
      }
    },
    [loadTaskFromBackend, applyTimerAllowance],
  )

  const restoreSession = useCallback(async () => {
    let session: Awaited<ReturnType<typeof fetchActivitySession>> = null
    try {
      session = await fetchActivitySession()
    } catch {
      applyPhase("online")
      return
    }
    if (!session) {
      applyPhase("online")
      return
    }
    sessionRef.current = session.id
    setSessionId(session.id)
    if (currentTaskRef.current?.id) {
      await loadTaskFromBackend(currentTaskRef.current.id)
    } else {
      activeRef.current = session.activeSeconds
      idleRef.current = session.idleSeconds
      setActiveSeconds(session.activeSeconds)
      setIdleSeconds(session.idleSeconds)
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, session.id)
    } catch {
      /* ignore */
    }
    if (session.status === "active") {
      const readiness = await refreshAgentStatus()
      if (readiness.canStartTimer) applyPhase("active")
      else {
        await postActivitySession("idle", sessionCounters())
        applyPhase("idle")
        notifyAgentTimerBlocked(
          `${getAgentTimerBlockMessage(readiness)} Timer paused until the agent reconnects.`,
        )
      }
    } else if (session.status === "idle") applyPhase("idle")
    else applyPhase("online")
  }, [applyPhase, loadTaskFromBackend, refreshAgentStatus, sessionCounters])

  const setIdle = useCallback(async () => {
    persistCurrentTaskTimer()
    const counters = sessionCounters()
    await postActivitySession("idle", counters)
    await syncTaskTracking("idle")
    applyPhase("idle")
  }, [applyPhase, persistCurrentTaskTimer, sessionCounters, syncTaskTracking])

  const stopTracking = useCallback(async () => {
    void releaseWakeLock()
    persistCurrentTaskTimer()
    const counters = sessionCounters()
    await postActivitySession("stop", counters)
    await syncTaskTracking("stop")
    sessionRef.current = null
    setSessionId(null)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    applyPhase("online")
  }, [applyPhase, persistCurrentTaskTimer, sessionCounters, syncTaskTracking])

  const ensureAgentReadyForTimer = useCallback(async (): Promise<boolean> => {
    const readiness = await refreshAgentStatus()
    if (readiness.canStartTimer) return true
    notifyAgentTimerBlocked(getAgentTimerBlockMessage(readiness))
    return false
  }, [refreshAgentStatus])

  const handleTaskLimitReached = useCallback(async () => {
    if (limitHandlingRef.current) return
    limitHandlingRef.current = true
    const taskTitle = currentTaskRef.current?.title ?? "Task"
    try {
      persistCurrentTaskTimer()
      const counters = sessionCounters()
      await postActivitySession("idle", counters)
      await syncTaskTracking("sync")
      applyPhase("idle")
      notifyTaskLimitReached(taskTitle, timerAllowanceRef.current?.message)
    } finally {
      limitHandlingRef.current = false
    }
  }, [applyPhase, persistCurrentTaskTimer, sessionCounters, syncTaskTracking])

  useEffect(() => {
    if (!authReadyRef.current) return
    const taskId = currentTaskRef.current?.id
    if (!taskId) return
    const timer = setTimeout(() => {
      void loadTaskFromBackend(taskId)
    }, 2500)
    return () => clearTimeout(timer)
  }, [isLoggedIn, sessionReady, user, profile?.mustChangePassword, loadTaskFromBackend])

  useEffect(() => {
    if (!isLoggedIn || !sessionReady || profile?.mustChangePassword) return

    if (!timersBootstrappedRef.current) {
      timersBootstrappedRef.current = true
      applyPhase("online")
      if (!deferInitialSessionRestore) {
        void restoreSession()
      }
    }

    tickTimerRef.current = setInterval(() => {
      if (isAgentMode && !canStartTimer) return
      if (phaseRef.current === "active") {
        activeRef.current += 1
        setActiveSeconds(activeRef.current)
        const taskId = currentTaskRef.current?.id
        if (taskId) {
          setTaskTimerState(taskId, {
            activeSeconds: activeRef.current,
            idleSeconds: idleRef.current,
          })
          const limit = taskLimitRef.current
          if (limit != null && activeRef.current >= limit) {
            void handleTaskLimitReached()
          }
        }
      } else if (phaseRef.current === "idle") {
        idleRef.current += 1
        setIdleSeconds(idleRef.current)
        const taskId = currentTaskRef.current?.id
        if (taskId) {
          setTaskTimerState(taskId, {
            activeSeconds: activeRef.current,
            idleSeconds: idleRef.current,
          })
        }
      }
    }, 1000)

    syncTimerRef.current = setInterval(() => {
      void syncSession()
    }, SYNC_MS)

    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      if (syncTimerRef.current) clearInterval(syncTimerRef.current)
      if (sessionPollRef.current) clearInterval(sessionPollRef.current)
      void releaseWakeLock()
    }
  }, [
    isLoggedIn,
    sessionReady,
    profile?.mustChangePassword,
    deferInitialSessionRestore,
    applyPhase,
    restoreSession,
    syncSession,
    handleTaskLimitReached,
    isAgentMode,
    canStartTimer,
  ])

  useEffect(() => {
    if (phase !== "active" && phase !== "idle") {
      if (sessionPollRef.current) clearInterval(sessionPollRef.current)
      sessionPollRef.current = null
      sessionMissStreakRef.current = 0
      return
    }

    const poll = async () => {
      let session: Awaited<ReturnType<typeof fetchActivitySession>> = null
      try {
        session = await fetchActivitySession()
      } catch {
        sessionMissStreakRef.current += 1
        return
      }

      if (!session) {
        sessionMissStreakRef.current += 1
        if (sessionMissStreakRef.current < SESSION_MISS_STOP_THRESHOLD) return
        void releaseWakeLock()
        sessionRef.current = null
        setSessionId(null)
        applyPhase("online")
        return
      }

      sessionMissStreakRef.current = 0

      if (session.status === "stopped") {
        void releaseWakeLock()
        sessionRef.current = null
        setSessionId(null)
        applyPhase("online")
        return
      }
      if (session.status === "idle" && phaseRef.current === "active") {
        applyPhase("idle")
      } else if (session.status === "active" && phaseRef.current === "idle") {
        const readiness = await refreshAgentStatus()
        if (readiness.canStartTimer) applyPhase("active")
        else {
          await postActivitySession("idle", sessionCounters())
          notifyAgentTimerBlocked(
            `${getAgentTimerBlockMessage(readiness)} Timer stays paused until the agent is linked.`,
          )
        }
      }
    }

    sessionPollRef.current = setInterval(() => {
      void poll()
    }, SESSION_POLL_MS)
    void poll()

    return () => {
      if (sessionPollRef.current) clearInterval(sessionPollRef.current)
      sessionPollRef.current = null
    }
  }, [phase, applyPhase, refreshAgentStatus, sessionCounters])

  useEffect(() => {
    if (phase !== "active") {
      void releaseWakeLock()
      return
    }

    void acquireWakeLock()
    const unbindVis = bindWakeLockVisibility()
    const stopIdleWatch = isAgentMode
      ? () => {}
      : startIdleWatch(() => {
          if (phaseRef.current === "active") void setIdle()
        })

    return () => {
      unbindVis()
      stopIdleWatch()
    }
  }, [phase, setIdle, isAgentMode])

  useEffect(() => {
    if (!isAgentMode || (phase !== "active" && phase !== "idle")) return

    const enforceAgentReady = async () => {
      const readiness = await refreshAgentStatus()
      if (readiness.canStartTimer) {
        agentFailStreakRef.current = 0
        return
      }
      if (phaseRef.current !== "active" && phaseRef.current !== "idle") return
      agentFailStreakRef.current += 1
      if (agentFailStreakRef.current < AGENT_FAIL_PAUSE_THRESHOLD) return
      agentFailStreakRef.current = 0
      await setIdle()
      notifyAgentTimerBlocked(
        `${getAgentTimerBlockMessage(readiness)} Timer paused until the agent reconnects.`,
      )
    }

    void enforceAgentReady()
    const interval = setInterval(() => {
      void enforceAgentReady()
    }, AGENT_CHECK_MS)
    return () => clearInterval(interval)
  }, [isAgentMode, phase, refreshAgentStatus, setIdle])

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (!(await ensureAgentReadyForTimer())) return false
    if (!currentTaskRef.current?.id) {
      notifyAgentTimerBlocked("Select a project and task in the Virtual Tracker Agent before starting the timer.")
      return false
    }
    const taskId = currentTaskRef.current.id
    const preflight = await fetchTaskTimeTracking(taskId)
    if (preflight?.timerAllowance?.limitReached) {
      notifyAgentTimerBlocked(preflight.timerAllowance.message || TIMER_LIMIT_REACHED_MESSAGE)
      return false
    }
    applyTimerAllowance(currentTaskRef.current, preflight?.timerAllowance)
    if (currentTaskRef.current?.id) {
      applyTaskTimerToRefs(
        currentTaskRef.current.id,
        activeRef,
        idleRef,
        setActiveSeconds,
        setIdleSeconds,
      )
    }
    const counters = sessionCounters()
    const started = await postActivitySessionDetailed("start", counters)
    if (!started.session) {
      notifyAgentTimerBlocked(started.error ?? getAgentTimerBlockMessage(await refreshAgentStatus()))
      return false
    }
    if (started.session.id) {
      sessionRef.current = started.session.id
      setSessionId(started.session.id)
      try {
        sessionStorage.setItem(STORAGE_KEY, started.session.id)
      } catch {
        /* ignore */
      }
    }
    await syncTaskTracking("start")
    applyPhase("active")
    pingActivityFeeds()
    return true
  }, [applyPhase, applyTimerAllowance, ensureAgentReadyForTimer, refreshAgentStatus, sessionCounters, syncTaskTracking])

  const resumeTracking = useCallback(async (): Promise<boolean> => {
    if (!(await ensureAgentReadyForTimer())) return false
    if (!currentTaskRef.current?.id) {
      notifyAgentTimerBlocked("Select a project and task in the Virtual Tracker Agent before resuming the timer.")
      return false
    }
    const taskId = currentTaskRef.current.id
    const preflight = await fetchTaskTimeTracking(taskId)
    if (preflight?.timerAllowance?.limitReached) {
      notifyAgentTimerBlocked(preflight.timerAllowance.message || TIMER_LIMIT_REACHED_MESSAGE)
      return false
    }
    applyTimerAllowance(currentTaskRef.current, preflight?.timerAllowance)
    if (currentTaskRef.current?.id) {
      applyTaskTimerToRefs(
        currentTaskRef.current.id,
        activeRef,
        idleRef,
        setActiveSeconds,
        setIdleSeconds,
      )
    }
    const counters = sessionCounters()
    const resumed = await postActivitySessionDetailed("resume", counters)
    if (!resumed.session) {
      notifyAgentTimerBlocked(resumed.error ?? getAgentTimerBlockMessage(await refreshAgentStatus()))
      return false
    }
    if (resumed.session.id) {
      sessionRef.current = resumed.session.id
      setSessionId(resumed.session.id)
    }
    await syncTaskTracking("resume")
    applyPhase("active")
    pingActivityFeeds()
    return true
  }, [applyPhase, applyTimerAllowance, ensureAgentReadyForTimer, refreshAgentStatus, sessionCounters, syncTaskTracking])

  const toggleTimer = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current === "active") {
      await setIdle()
      return true
    }
    return resumeTracking()
  }, [setIdle, resumeTracking])

  const isAgentCapturing =
    isAgentMode && isLocalAgentRunning && phase === "active" && sessionId !== null

  const value: ActivityTrackingContextValue = {
    phase,
    activeSeconds,
    idleSeconds,
    progressPercent,
    taskStatus,
    isTimerRunning: phase === "active",
    sessionId,
    isAgentCapturing,
    currentTask,
    taskLimitSeconds,
    canStartTimer,
    setCurrentTask,
    startTracking,
    restoreSession,
    setIdle,
    resumeTracking,
    stopTracking,
    toggleTimer,
  }

  return <ActivityTrackingContext.Provider value={value}>{children}</ActivityTrackingContext.Provider>
}

export { LIMIT_EVENT as TASK_TIMER_LIMIT_EVENT }
