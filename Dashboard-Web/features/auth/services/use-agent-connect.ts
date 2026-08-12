"use client"

import { useEffect, useState } from "react"
import { openDesktopAgentDeepLink } from "@/features/auth/services/navigation"

const AUTO_CLOSE_GRACE_MS = 400
const FALLBACK_REVEAL_MS = 2500

/**
 * Fires the virtualtracker:// deep link once `enabled` turns true. A web page
 * gets no callback for "the custom-scheme handler ran successfully" - the
 * best available signal is the browser tab losing focus shortly after, which
 * happens when the OS actually switches to the desktop agent. On that blur,
 * assume the handoff worked and close this tab. If nothing happens within
 * FALLBACK_REVEAL_MS - no handler registered, or the user dismissed the
 * "Open Virtual Tracker Agent?" prompt - reveal a manual retry instead of
 * leaving the tab looking stuck.
 */
export function useAgentConnectAndAutoClose(enabled: boolean): {
  showFallback: boolean
  connect: () => void
} {
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let handled = false
    openDesktopAgentDeepLink()

    function onBlur() {
      if (handled) return
      handled = true
      window.setTimeout(() => {
        try {
          window.close()
        } catch {
          /* ignore - the fallback button covers this */
        }
      }, AUTO_CLOSE_GRACE_MS)
    }

    window.addEventListener("blur", onBlur)
    const timer = window.setTimeout(() => {
      if (!handled) setShowFallback(true)
    }, FALLBACK_REVEAL_MS)

    return () => {
      window.removeEventListener("blur", onBlur)
      window.clearTimeout(timer)
    }
  }, [enabled])

  return { showFallback, connect: openDesktopAgentDeepLink }
}
