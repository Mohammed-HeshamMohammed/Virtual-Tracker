"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchGeneralDashboardData,
  invalidateGeneralDashboardCache,
} from "@/features/dashboard/api/general-dashboard-api"
import type { GeneralDashboardPayload } from "@/features/dashboard/components/general/constants"

type GeneralDashboardState = {
  data: GeneralDashboardPayload | null
  loading: boolean
  error: string | null
  refreshing: boolean
}

export function useGeneralDashboardData(enabled = true) {
  const [state, setState] = useState<GeneralDashboardState>({
    data: null,
    loading: true,
    error: null,
    refreshing: false,
  })
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState((prev) => ({
      ...prev,
      loading: !options?.background && !prev.data,
      refreshing: Boolean(options?.background),
      error: null,
    }))

    try {
      const data = await fetchGeneralDashboardData({ force: options?.force, signal: controller.signal })
      if (controller.signal.aborted) return
      setState({ data, loading: false, error: null, refreshing: false })
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : "Failed to load dashboard"
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: message,
      }))
    }
  }, [enabled])

  const retry = useCallback(() => {
    invalidateGeneralDashboardCache()
    void load({ force: true })
  }, [load])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      void load({ background: true })
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [enabled, load])

  return { ...state, retry, reload: retry }
}
