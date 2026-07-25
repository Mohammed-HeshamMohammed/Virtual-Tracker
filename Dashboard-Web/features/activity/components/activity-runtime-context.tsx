"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { AgentStatusProvider } from "@/features/activity/components/agent-status-context"
import { ActivitySessionGuard } from "@/features/activity/components/activity-session-guard"
import { ActivityTrackingProvider } from "@/features/activity/components/activity-tracking-context"
import { WebActivityReporter } from "@/features/activity/components/web-activity-reporter"
import { ActivityRuntimeBootstrap } from "@/features/activity/components/activity-runtime-bootstrap"

export type ActivityRuntimePending = {
  /** "adopt" reflects a session that already exists (e.g. one the desktop agent
   * started) without POSTing a new one — no task-selection or readiness gate. */
  action: "start" | "resume" | "adopt"
  openPopup?: boolean
}

type ActivityRuntimeContextValue = {
  active: boolean
  pending: ActivityRuntimePending | null
  requestActivityRuntime: (pending: ActivityRuntimePending) => void
  clearPending: () => void
}

const ActivityRuntimeContext = createContext<ActivityRuntimeContextValue | undefined>(undefined)

export function useActivityRuntime(): ActivityRuntimeContextValue {
  const ctx = useContext(ActivityRuntimeContext)
  if (!ctx) {
    throw new Error("useActivityRuntime must be used within ActivityRuntimeProvider")
  }
  return ctx
}

/** Activity APIs load only after timer start/resume. */
export function ActivityRuntimeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState<ActivityRuntimePending | null>(null)

  const requestActivityRuntime = useCallback((next: ActivityRuntimePending) => {
    setPending(next)
    setActive(true)
  }, [])

  const clearPending = useCallback(() => {
    setPending(null)
  }, [])

  const value = useMemo(
    () => ({
      active,
      pending,
      requestActivityRuntime,
      clearPending,
    }),
    [active, pending, requestActivityRuntime, clearPending],
  )

  return (
    <ActivityRuntimeContext.Provider value={value}>
      <AgentStatusProvider deferPollingUntilRefresh={!active}>
        <ActivitySessionGuard />
        {active ? (
          <ActivityTrackingProvider deferInitialSessionRestore>
            <ActivityRuntimeBootstrap pending={pending} onComplete={clearPending} />
            <WebActivityReporter />
            {children}
          </ActivityTrackingProvider>
        ) : (
          children
        )}
      </AgentStatusProvider>
    </ActivityRuntimeContext.Provider>
  )
}
