"use client"

import { useCallback, useEffect, useState } from "react"
import { listScreenshotRemovalRequests } from "@/features/activity/services/activity-api"

/**
 * How many removal requests are waiting, for the badge in the activity
 * control bar.
 *
 * Shared by every Activity page so the count follows a reviewer around
 * rather than only existing on Screenshots - a request raised while they are
 * looking at Apps is still waiting on them.
 *
 * Fails to zero rather than throwing: a badge is not worth breaking a page
 * over, and people without permission simply never see one.
 */
export function useRemovalRequestCount(enabled: boolean): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0)

  const refresh = useCallback(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    listScreenshotRemovalRequests("pending")
      .then((result) => setCount(result.pendingCount))
      .catch(() => setCount(0))
  }, [enabled])

  useEffect(() => {
    refresh()
    // Someone else may resolve a request while this page is open, and a badge
    // that only updates on navigation would keep showing work already done.
    const timer = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return { count, refresh }
}
