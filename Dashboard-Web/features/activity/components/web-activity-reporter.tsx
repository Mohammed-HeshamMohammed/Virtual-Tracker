"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"
import { createWebActivityTracker } from "@/features/activity/utils/web-activity-tracker"

/** In-browser capture — only when server capture mode is `web`. */
export function WebActivityReporter() {
  const { isAgentMode } = useAgentStatus()
  const { phase, sessionId } = useActivityTracking()
  const pathname = usePathname()
  const trackerRef = useRef<ReturnType<typeof createWebActivityTracker> | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    if (isAgentMode || phase !== "active" || !sessionId) {
      trackerRef.current?.stop()
      trackerRef.current = null
      return
    }

    const tracker = createWebActivityTracker({
      sessionId,
      isActive: () => phaseRef.current === "active",
      onFlush: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("vt-activity-ping"))
        }
      },
    })
    trackerRef.current = tracker
    tracker.start()

    return () => {
      tracker.stop()
      if (trackerRef.current === tracker) trackerRef.current = null
    }
  }, [isAgentMode, phase, sessionId])

  useEffect(() => {
    trackerRef.current?.onRouteChange()
  }, [pathname])

  return null
}
