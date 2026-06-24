"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useActivitySelectedDay } from "@/features/activity/utils/activity-day-utils"

export type ActivitySubPage = "activity-screenshots" | "activity-apps" | "activity-urls"
export type ActivitySortOrder = "newest" | "oldest" | "time" | "name"

type SearchByPage = Record<"screenshots" | "apps" | "urls", string>
type CategoryByPage = Record<"apps" | "urls", string>
type SortByPage = Record<"screenshots" | "apps" | "urls", ActivitySortOrder>

const DEFAULT_SORT: SortByPage = {
  screenshots: "newest",
  apps: "time",
  urls: "time",
}

interface ActivityShellContextValue {
  pageId: ActivitySubPage
  day: ReturnType<typeof useActivitySelectedDay>
  searchQuery: string
  setSearchQuery: (value: string) => void
  searchPlaceholder: string
  selectedCategory: string
  setSelectedCategory: (value: string) => void
  viewMode: "grid" | "list"
  setViewMode: (mode: "grid" | "list") => void
  showBlocked: boolean
  setShowBlocked: (value: boolean) => void
  sortOrder: ActivitySortOrder
  setSortOrder: (value: ActivitySortOrder) => void
  resetPageFilters: () => void
  showExport: boolean
  triggerRefresh: () => void
  triggerExport: () => void
  registerRefresh: (fn: (() => void) | null) => void
  registerExport: (fn: (() => void) | null) => void
}

const ActivityShellContext = createContext<ActivityShellContextValue | undefined>(undefined)

function pageKey(pageId: ActivitySubPage): "screenshots" | "apps" | "urls" {
  if (pageId === "activity-apps") return "apps"
  if (pageId === "activity-urls") return "urls"
  return "screenshots"
}

const SEARCH_PLACEHOLDERS: Record<ActivitySubPage, string> = {
  "activity-screenshots": "Search…",
  "activity-apps": "Search apps…",
  "activity-urls": "Search URLs…",
}

export function useActivityShell() {
  const ctx = useContext(ActivityShellContext)
  if (!ctx) throw new Error("useActivityShell must be used within ActivityShellProvider")
  return ctx
}

export function useActivityShellRegistration(options: {
  onRefresh: () => void
  onExport?: () => void
}) {
  const { registerRefresh, registerExport } = useActivityShell()
  const { onRefresh, onExport } = options

  useEffect(() => {
    registerRefresh(onRefresh)
    return () => registerRefresh(null)
  }, [onRefresh, registerRefresh])

  useEffect(() => {
    if (!onExport) {
      registerExport(null)
      return
    }
    registerExport(onExport)
    return () => registerExport(null)
  }, [onExport, registerExport])
}

export function ActivityShellProvider({
  pageId,
  children,
}: {
  pageId: ActivitySubPage
  children: ReactNode
}) {
  const day = useActivitySelectedDay()
  const refreshRef = useRef<(() => void) | null>(null)
  const exportRef = useRef<(() => void) | null>(null)

  const [searchByPage, setSearchByPage] = useState<SearchByPage>({
    screenshots: "",
    apps: "",
    urls: "",
  })
  const [categoryByPage, setCategoryByPage] = useState<CategoryByPage>({
    apps: "all",
    urls: "all",
  })
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [showBlocked, setShowBlocked] = useState(false)
  const [sortByPage, setSortByPage] = useState<SortByPage>({ ...DEFAULT_SORT })

  const key = pageKey(pageId)
  const searchQuery = searchByPage[key]
  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchByPage((prev) => ({ ...prev, [key]: value }))
    },
    [key],
  )

  const selectedCategory = key === "screenshots" ? "all" : categoryByPage[key]
  const sortOrder = sortByPage[key]
  const setSortOrder = useCallback(
    (value: ActivitySortOrder) => {
      setSortByPage((prev) => ({ ...prev, [key]: value }))
    },
    [key],
  )

  const resetPageFilters = useCallback(() => {
    setSearchByPage((prev) => ({ ...prev, [key]: "" }))
    if (key !== "screenshots") {
      setCategoryByPage((prev) => ({ ...prev, [key]: "all" }))
    }
    setViewMode("grid")
    setShowBlocked(false)
    setSortByPage((prev) => ({ ...prev, [key]: DEFAULT_SORT[key] }))
  }, [key])

  const setSelectedCategory = useCallback(
    (value: string) => {
      if (key === "screenshots") return
      setCategoryByPage((prev) => ({ ...prev, [key]: value }))
    },
    [key],
  )

  const registerRefresh = useCallback((fn: (() => void) | null) => {
    refreshRef.current = fn
  }, [])

  const registerExport = useCallback((fn: (() => void) | null) => {
    exportRef.current = fn
  }, [])

  const triggerRefresh = useCallback(() => {
    refreshRef.current?.()
  }, [])

  const triggerExport = useCallback(() => {
    exportRef.current?.()
  }, [])

  const value = useMemo<ActivityShellContextValue>(
    () => ({
      pageId,
      day,
      searchQuery,
      setSearchQuery,
      searchPlaceholder: SEARCH_PLACEHOLDERS[pageId],
      selectedCategory,
      setSelectedCategory,
      viewMode,
      setViewMode,
      showBlocked,
      setShowBlocked,
      sortOrder,
      setSortOrder,
      resetPageFilters,
      showExport: pageId !== "activity-screenshots",
      triggerRefresh,
      triggerExport,
      registerRefresh,
      registerExport,
    }),
    [
      pageId,
      day,
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      viewMode,
      showBlocked,
      sortOrder,
      resetPageFilters,
      triggerRefresh,
      triggerExport,
      registerRefresh,
      registerExport,
    ],
  )

  return <ActivityShellContext.Provider value={value}>{children}</ActivityShellContext.Provider>
}
