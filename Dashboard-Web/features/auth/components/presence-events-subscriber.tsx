"use client"

import { useEffect } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  closePresenceEventStream,
  openPresenceEventStream,
} from "@/features/auth/services/presence-events-sse"

export function PresenceEventsSubscriber() {
  const { isLoggedIn, sessionReady, profile } = useAuth()
  const shouldSubscribe = Boolean(isLoggedIn && sessionReady && !profile?.mustChangePassword)

  useEffect(() => {
    if (!shouldSubscribe) return

    void openPresenceEventStream()
  }, [shouldSubscribe])

  useEffect(() => {
    if (shouldSubscribe) return
    closePresenceEventStream()
  }, [shouldSubscribe])

  return null
}
