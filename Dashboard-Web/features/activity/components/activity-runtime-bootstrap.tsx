"use client"

import { useEffect } from "react"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { AGENT_TIMER_BLOCKED_EVENT, getAgentTimerBlockMessage } from "@/features/activity/utils/agent-timer-gate"
import { getTimerTask } from "@/features/activity/utils/timer-task-storage"
import type { ActivityRuntimePending } from "@/features/activity/components/activity-runtime-context"

const OPEN_POPUP_EVENT = "vt-timer-open-popup"

export function dispatchTimerOpenPopup(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_POPUP_EVENT))
  }
}

export function subscribeTimerOpenPopup(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(OPEN_POPUP_EVENT, handler)
  return () => window.removeEventListener(OPEN_POPUP_EVENT, handler)
}

type ActivityRuntimeBootstrapProps = {
  pending: ActivityRuntimePending | null
  onComplete: () => void
}

export function ActivityRuntimeBootstrap({ pending, onComplete }: ActivityRuntimeBootstrapProps) {
  const { startTracking, resumeTracking, setCurrentTask } = useActivityTracking()
  const { refreshAgentStatus } = useAgentStatus()

  useEffect(() => {
    if (!pending) return

    let cancelled = false

    void (async () => {
      const task = getTimerTask()
      if (task) setCurrentTask(task)

      const readiness = await refreshAgentStatus()
      if (cancelled) return

      if (!readiness.canStartTimer) {
        window.dispatchEvent(
          new CustomEvent(AGENT_TIMER_BLOCKED_EVENT, {
            detail: { message: getAgentTimerBlockMessage(readiness) },
          }),
        )
        onComplete()
        return
      }

      const ok =
        pending.action === "start" ? await startTracking() : await resumeTracking()
      if (cancelled) return

      if (ok && pending.openPopup) {
        window.setTimeout(() => dispatchTimerOpenPopup(), 0)
      }
      onComplete()
    })()

    return () => {
      cancelled = true
    }
  }, [pending, onComplete, refreshAgentStatus, resumeTracking, setCurrentTask, startTracking])

  return null
}
