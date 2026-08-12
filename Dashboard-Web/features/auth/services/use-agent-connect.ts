"use client"

import { useEffect, useState } from "react"
import { openDesktopAgentDeepLink } from "@/features/auth/services/navigation"

const AUTO_CLOSE_AFTER_MS = 1200
const FALLBACK_REVEAL_AFTER_MS = 1800

/**
 * Fires the virtualtracker:// deep link once `enabled` turns true, then tries
 * to close this tab shortly after, and reveals a manual "Connect" button if
 * that close attempt didn't actually happen.
 *
 * Deliberately timer-based, not focus-based: an earlier version closed only
 * on the browser tab's `blur` event (the OS switching focus to the agent).
 * That's unreliable - Windows' focus-stealing prevention frequently lets a
 * newly-activated window become visible/foreground-looking without ever
 * actually pulling OS input focus from the browser, so `blur` silently never
 * fires even though the deep link worked and the agent is right there. A
 * fixed timer doesn't depend on that. `window.close()` also has no
 * success/failure callback - if it's blocked (tabs the browser didn't open
 * via script can't be closed by script), the page is still around when the
 * fallback timer fires and the button appears; if it succeeded, the
 * component is unmounted and the timer never has anything to do.
 */
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
