"use client"

import { useEffect } from "react"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import type { ActivityRuntimePending } from "@/features/activity/components/activity-runtime-context"

type ActivityRuntimeBootstrapProps = {
  pending: ActivityRuntimePending | null
  onComplete: () => void
}

/** Adopts a session the desktop agent already started — reflects it, never starts one. */
export function ActivityRuntimeBootstrap({ pending, onComplete }: ActivityRuntimeBootstrapProps) {
  const { restoreSession } = useActivityTracking()

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    void (async () => {
      await restoreSession()
      if (!cancelled) onComplete()
    })()
    return () => {
      cancelled = true
    }
  }, [pending, onComplete, restoreSession])

  return null
}
