"use client"

import { useEffect } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  closePresenceEventStream,
  isPresenceEventStreamOpen,
  openPresenceEventStream,
} from "@/features/auth/services/presence-events-sse"

const CONNECT_RETRY_MS = 10_000

export function PresenceEventsSubscriber() {
  const { isLoggedIn, sessionReady, profile } = useAuth()
  const shouldSubscribe = Boolean(isLoggedIn && sessionReady && !profile?.mustChangePassword)

  useEffect(() => {
    if (!shouldSubscribe) return

    let cancelled = false

    const ensureOpen = async () => {
      await openPresenceEventStream()
    }

    void ensureOpen()

    const retryTimer = setInterval(() => {
      if (cancelled || isPresenceEventStreamOpen()) return
      void ensureOpen()
    }, CONNECT_RETRY_MS)

    return () => {
      cancelled = true
      clearInterval(retryTimer)
    }
  }, [shouldSubscribe])

  useEffect(() => {
    if (shouldSubscribe) return
    closePresenceEventStream()
  }, [shouldSubscribe])

  return null
}
