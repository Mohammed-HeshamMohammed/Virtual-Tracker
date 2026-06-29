/* eslint-disable react-doctor/no-initialize-state */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  getProjectOverviewCore,
  getProjectOverviewPanels,
  type ProjectOverviewCore,
  type ProjectOverviewPanels,
} from "@/features/projects/api/project-overview-api"

export type UseProjectOverviewResult = {
  core: ProjectOverviewCore | null
  panels: ProjectOverviewPanels | null
  isCoreLoading: boolean
  isPanelsLoading: boolean
  panelsError: Error | null
  loadPanels: () => Promise<void>
  belowFoldRef: (node: HTMLElement | null) => void
}

export function useProjectOverview(): UseProjectOverviewResult {
  const [core, setCore] = useState<ProjectOverviewCore | null>(null)
  const [panels, setPanels] = useState<ProjectOverviewPanels | null>(null)
  const [isCoreLoading, setIsCoreLoading] = useState(true)
  const [isPanelsLoading, setIsPanelsLoading] = useState(false)
  const [panelsError, setPanelsError] = useState<Error | null>(null)

  const panelsRequestedRef = useRef(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const belowFoldElRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setIsCoreLoading(true)
    getProjectOverviewCore({ signal: ac.signal })
      .then(setCore)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return
        console.error("Project overview core load failed:", err)
        setCore(null)
      })
      .finally(() => {
        if (!ac.signal.aborted) setIsCoreLoading(false)
      })
    return () => ac.abort()
  }, [])

  const loadPanels = useCallback(async () => {
    if (panelsRequestedRef.current) return
    panelsRequestedRef.current = true
    setIsPanelsLoading(true)
    setPanelsError(null)
    try {
      const data = await getProjectOverviewPanels({ taskLimit: 80 })
      setPanels(data)
    } catch (err: unknown) {
      panelsRequestedRef.current = false
      setPanelsError(err instanceof Error ? err : new Error("Failed to load overview panels"))
    } finally {
      setIsPanelsLoading(false)
    }
  }, [])

  const belowFoldRef = useCallback(
    (node: HTMLElement | null) => {
      belowFoldElRef.current = node
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!node) return

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) void loadPanels()
        },
        { root: null, rootMargin: "120px 0px", threshold: 0 },
      )
      observerRef.current.observe(node)
    },
    [loadPanels],
  )

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return {
    core,
    panels,
    isCoreLoading,
    isPanelsLoading,
    panelsError,
    loadPanels,
    belowFoldRef,
  }
}
