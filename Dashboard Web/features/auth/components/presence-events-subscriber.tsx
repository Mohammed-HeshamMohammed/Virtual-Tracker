"use client"

import { useEffect } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  closePresenceEventStream,
  openPresenceEventStream,
} from "@/features/auth/services/presence-events-sse"

/**
 * Live presence fan-out for member lists (SSE backed by Firebase RTD when configured).
 */
export function PresenceEventsSubscriber() {
  const { isLoggedIn, sessionReady, profile } = useAuth()

  useEffect(() => {
    if (!isLoggedIn || !sessionReady || profile?.mustChangePassword) return

    let cancelled = false
    void (async () => {
      const ok = await openPresenceEventStream()
      if (!cancelled && !ok) {
        // SSE unavailable — member lists still refetch on tab focus.
      }
    })()

    return () => {
      cancelled = true
      closePresenceEventStream()
    }
  }, [isLoggedIn, sessionReady, profile?.mustChangePassword])

  return null
}
