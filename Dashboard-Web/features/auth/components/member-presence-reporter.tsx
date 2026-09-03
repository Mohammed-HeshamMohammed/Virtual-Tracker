"use client"

import { useCallback, useEffect, useRef } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  bindPresenceActivityListeners,
  connectPresenceWebSocket,
  disconnectPresenceWebSocket,
  isPresenceWebSocketConnected,
  sendPresenceActivity,
} from "@/features/auth/services/presence-ws"

const ACTIVITY_DEBOUNCE_MS = 8_000
const CONNECT_RETRY_MS = 10_000

export function MemberPresenceReporter() {
  const { isLoggedIn, user, profile, sessionReady } = useAuth()
  const shouldConnect = Boolean(isLoggedIn && user && sessionReady && !profile?.mustChangePassword)
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onActivity = useCallback(() => {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    activityTimerRef.current = setTimeout(() => {
      sendPresenceActivity()
    }, ACTIVITY_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    if (!shouldConnect) return

    let cancelled = false

    const ensureConnected = async () => {
      const ok = await connectPresenceWebSocket()
      if (!cancelled && ok) sendPresenceActivity()
    }

    void ensureConnected()

    const retryTimer = setInterval(() => {
      if (cancelled || isPresenceWebSocketConnected()) return
      void ensureConnected()
    }, CONNECT_RETRY_MS)

    const unbind = bindPresenceActivityListeners(onActivity)

    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener("mousemove", onActivity, opts)
    window.addEventListener("keydown", onActivity)
    window.addEventListener("scroll", onActivity, opts)
    window.addEventListener("touchstart", onActivity, opts)

    const onVis = () => {
      if (document.visibilityState === "visible") onActivity()
    }
    document.addEventListener("visibilitychange", onVis)

    return () => {
      cancelled = true
      clearInterval(retryTimer)
      unbind()
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
      window.removeEventListener("mousemove", onActivity)
      window.removeEventListener("keydown", onActivity)
      window.removeEventListener("scroll", onActivity)
      window.removeEventListener("touchstart", onActivity)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [shouldConnect, onActivity])

  useEffect(() => {
    if (shouldConnect) return
    disconnectPresenceWebSocket()
  }, [shouldConnect])

  return null
}
