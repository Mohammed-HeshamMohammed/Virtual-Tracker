"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchCommandCenterData, invalidateCommandCenterCache } from "@/features/dashboard/api/command-center-api"
import { mapCommandCenterPayload } from "@/features/dashboard/utils/command-center-mapper"
import type { ActivityFeedItem, ProjectData } from "@/features/dashboard/components/command-center/constants"

type CommandCenterState = {
  projects: ProjectData[]
  globalActivityFeed: ActivityFeedItem[]
  canSeeAllProjects: boolean
  roleName: string
  loading: boolean
  error: string | null
  refreshing: boolean
}

export function useCommandCenterData(enabled = true) {
  const [state, setState] = useState<CommandCenterState>({
    projects: [],
    globalActivityFeed: [],
    canSeeAllProjects: false,
    roleName: "",
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
      loading: !options?.background && prev.projects.length === 0,
      refreshing: Boolean(options?.background),
      error: null,
    }))

    try {
      const raw = await fetchCommandCenterData({ force: options?.force, signal: controller.signal })
      const mapped = mapCommandCenterPayload(raw)
      if (controller.signal.aborted) return
      setState({
        ...mapped,
        loading: false,
        error: null,
        refreshing: false,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : "Failed to load Command Center"
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: message,
      }))
    }
  }, [enabled])

  const retry = useCallback(() => {
    invalidateCommandCenterCache()
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

  return {
    ...state,
    retry,
    reload: retry,
  }
}
