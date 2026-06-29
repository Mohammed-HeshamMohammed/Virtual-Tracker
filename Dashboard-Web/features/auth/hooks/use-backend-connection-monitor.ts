"use client"

import { useEffect } from "react"
import { checkAllBackendsReady } from "@/features/auth/services/backend-availability"

const PROBE_INTERVAL_MS = 20_000

/** Periodically probes API readiness while the dashboard session is active. */
export function useBackendConnectionMonitor(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const probe = async () => {
      if (cancelled) return
      await checkAllBackendsReady()
    }

    void probe()

    const interval = window.setInterval(() => {
      void probe()
    }, PROBE_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === "visible") void probe()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [enabled])
}
