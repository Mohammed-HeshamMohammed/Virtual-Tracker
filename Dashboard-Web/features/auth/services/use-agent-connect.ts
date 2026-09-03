"use client"

import { useEffect, useState } from "react"
import { openDesktopAgentDeepLink } from "@/features/auth/services/navigation"

const AUTO_CLOSE_AFTER_MS = 1200
const FALLBACK_REVEAL_AFTER_MS = 1800

export function useAgentConnectAndAutoClose(enabled: boolean): {
  showFallback: boolean
  connect: () => void
} {
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (!enabled) return
    openDesktopAgentDeepLink()

    const closeTimer = window.setTimeout(() => {
      try {
        window.close()
      } catch {
        /* ignore - the fallback button covers this */
      }
    }, AUTO_CLOSE_AFTER_MS)

    const fallbackTimer = window.setTimeout(() => {
      setShowFallback(true)
    }, FALLBACK_REVEAL_AFTER_MS)

    return () => {
      window.clearTimeout(closeTimer)
      window.clearTimeout(fallbackTimer)
    }
  }, [enabled])

  return { showFallback, connect: openDesktopAgentDeepLink }
}
