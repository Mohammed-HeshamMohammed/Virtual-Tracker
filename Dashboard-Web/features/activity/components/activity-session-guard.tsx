"use client"

import { useEffect, useRef } from "react"
import { useAuth } from "@/shared/providers/app"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import {
  fetchActivitySession,
  postActivitySessionDetailed,
} from "@/features/activity/services/activity-api"
import {
  getAgentTimerBlockMessage,
  notifyAgentTimerBlocked,
} from "@/features/activity/utils/agent-timer-gate"

export function ActivitySessionGuard() {
  const { isLoggedIn, sessionReady, profile } = useAuth()
  const { refreshAgentStatus } = useAgentStatus()
  const ranRef = useRef(false)

  useEffect(() => {
    if (!isLoggedIn || !sessionReady || profile?.mustChangePassword) return
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      const session = await fetchActivitySession()
      if (!session || session.status !== "active") return

      const readiness = await refreshAgentStatus()
      if (readiness.canStartTimer) return

      await postActivitySessionDetailed("idle", {
        activeSeconds: session.activeSeconds,
        idleSeconds: session.idleSeconds,
        taskId: session.taskId ?? null,
      })
      notifyAgentTimerBlocked(
        `${getAgentTimerBlockMessage(readiness)} An active timer was paused because the agent is not linked.`,
      )
    })()
  }, [isLoggedIn, profile?.mustChangePassword, refreshAgentStatus, sessionReady])

  return null
}
