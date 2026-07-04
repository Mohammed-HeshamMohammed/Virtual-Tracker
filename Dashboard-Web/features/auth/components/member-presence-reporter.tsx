"use client"

import { useCallback, useEffect, useRef } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  bindPresenceActivityListeners,
  connectPresenceWebSocket,
  disconnectPresenceWebSocket,
  sendPresenceActivity,
} from "@/features/auth/services/presence-ws"

const ACTIVITY_DEBOUNCE_MS = 8_000

/** Presence WS after login — backend tracks online/idle/offline. */
export function MemberPresenceReporter() {
  const { isLoggedIn, user, profile, sessionReady } = useAuth()
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onActivity = useCallback(() => {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    activityTimerRef.current = setTimeout(() => {
      sendPresenceActivity()
    }, ACTIVITY_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    if (!isLoggedIn || !user || !sessionReady || profile?.mustChangePassword) return

    let cancelled = false
    void (async () => {
      const ok = await connectPresenceWebSocket()
      if (!cancelled && ok) {
        sendPresenceActivity()
      }
    })()

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
      unbind()
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
      window.removeEventListener("mousemove", onActivity)
      window.removeEventListener("keydown", onActivity)
      window.removeEventListener("scroll", onActivity)
      window.removeEventListener("touchstart", onActivity)
      document.removeEventListener("visibilitychange", onVis)
      disconnectPresenceWebSocket()
    }
  }, [isLoggedIn, user, sessionReady, profile?.mustChangePassword, onActivity])

  return null
}
