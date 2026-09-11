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
import { ActivityTrackingProvider } from "@/features/activity/components/activity-tracking-context"
import { WebActivityReporter } from "@/features/activity/components/web-activity-reporter"
import { ActivityRuntimeBootstrap } from "@/features/activity/components/activity-runtime-bootstrap"

export type ActivityRuntimePending = {
  action: "adopt"
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

/**
 * `requestActivityRuntime` has no callers. The top-bar Start button was the
 * only one - it "adopted" any session the agent had started and switched this
 * runtime on - and it is now navigation-only. So `active` stays false and the
 * tracking provider below never mounts: the dashboard does not mirror, pause
 * or stop the agent's timer. The agent owns it, and the server enforces that
 * (routes.js ignores dashboard pause/stop/resume/sync on agent sessions).
 */
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
        {/* ActivitySessionGuard used to sit here, outside the runtime, and on
            every dashboard load paused the agent's timer if a single status
            check said "offline". Removed with the rest of the dashboard's
            timer control - see PLAN-timer-stop-resilience.md, A1. */}
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
