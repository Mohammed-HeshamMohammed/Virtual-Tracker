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
import { useAuth } from "@/shared/providers/app"
import {
  fetchActivityScope,
  clearActivityApiFeedCache,
  type ActivityFeedQuery,
  type ActivityFeedScope,
} from "@/features/activity/services/activity-api"
import { ACTIVITY_FEED_PING_DEBOUNCE_MS, ACTIVITY_FEED_POLL_MS } from "@/infrastructure/config/firestore-throttle"
import {
  buildActivityFeedCacheKey,
  clearActivityFeedCache,
  deleteActivityFeedCache,
  readActivityFeedCache,
  writeActivityFeedCache,
  type ActivityFeedCacheEntry,
} from "@/features/activity/utils/activity-feed-cache"
import {
  clearAllActivityScopePreferences,
  readStoredProjectScopeOnly,
  readStoredSelectedMemberId,
  writeStoredProjectScopeOnly,
  writeStoredSelectedMemberId,
} from "@/features/activity/utils/activity-scope-preferences"

export interface ActivityMemberOption {
  id: string
  name: string
  initials: string
}

export type { ActivityFeedCacheEntry }

interface ActivityFeedContextValue {
  scope: ActivityFeedScope | null
  canFilterByProject: boolean
  selectedMemberId: string
  setSelectedMemberId: (id: string) => void
  projectScopeOnly: boolean
  setProjectScopeOnly: (value: boolean) => void
  scopeLoading: boolean
  refreshScope: () => Promise<void>
  getCacheKey: (query: ActivityFeedQuery, options?: { myTeamOnly?: boolean }) => string
  readCache: (key: string) => ActivityFeedCacheEntry | undefined
  writeCache: (key: string, entry: ActivityFeedCacheEntry) => void
  deleteCache: (key: string) => void
  clearAllCache: () => void
  isActivityPageActive: boolean
  setActivityPageActive: (active: boolean) => void
  buildQuery: (type: ActivityFeedQuery["type"]) => ActivityFeedQuery
}

const ActivityFeedContext = createContext<ActivityFeedContextValue | undefined>(undefined)

const POLL_MS = ACTIVITY_FEED_POLL_MS
const PING_DEBOUNCE_MS = ACTIVITY_FEED_PING_DEBOUNCE_MS

export function useActivityFeedContext() {
  const ctx = useContext(ActivityFeedContext)
  if (!ctx) throw new Error("useActivityFeedContext must be used within ActivityFeedProvider")
  return ctx
}

export function ActivityFeedProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, memberId: viewerMemberId } = useAuth()
  const [scope, setScope] = useState<ActivityFeedScope | null>(null)
  const [canFilterByProject, setCanFilterByProject] = useState(false)
  const [scopeLoading, setScopeLoading] = useState(true)
  const [selectedMemberId, setSelectedMemberIdState] = useState(() => readStoredSelectedMemberId(viewerMemberId))
  const [projectScopeOnly, setProjectScopeOnlyState] = useState(readStoredProjectScopeOnly)
  const [isActivityPageActive, setActivityPageActive] = useState(false)
  const pingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevViewerMemberIdRef = useRef<string | null>(viewerMemberId ?? null)
  const prevProjectScopeOnlyRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!viewerMemberId) {
      setSelectedMemberIdState("all")
      return
    }
    setProjectScopeOnlyState(readStoredProjectScopeOnly())
    setSelectedMemberIdState(readStoredSelectedMemberId(viewerMemberId))
  }, [viewerMemberId])

  const setSelectedMemberId = useCallback(
    (id: string) => {
      setSelectedMemberIdState(id)
      writeStoredSelectedMemberId(viewerMemberId, id)
    },
    [viewerMemberId],
  )

  const refreshScope = useCallback(async () => {
    if (!isLoggedIn || !viewerMemberId) {
      setScope(null)
      setCanFilterByProject(false)
      setScopeLoading(false)
      return
    }
    if (!scope) setScopeLoading(true)
    const next = await fetchActivityScope(projectScopeOnly)
    if (next) {
      setScope(next)
      setCanFilterByProject(next.canFilterByProject)
      setSelectedMemberIdState((prev) => {
        let resolved = prev
        if (prev === "all" && !next.canSeeAllMembers) resolved = next.defaultMemberId
        if (prev !== "all" && !next.members.some((member) => member.id === prev)) {
          resolved = next.defaultMemberId
        }
        writeStoredSelectedMemberId(viewerMemberId, resolved)
        return resolved
      })
    }
    setScopeLoading(false)
  }, [isLoggedIn, viewerMemberId, projectScopeOnly, scope])

  useEffect(() => {
    const viewerChanged = prevViewerMemberIdRef.current !== (viewerMemberId ?? null)
    const projectScopeChanged =
      prevProjectScopeOnlyRef.current !== null && prevProjectScopeOnlyRef.current !== projectScopeOnly

    prevViewerMemberIdRef.current = viewerMemberId ?? null
    prevProjectScopeOnlyRef.current = projectScopeOnly

    if (viewerChanged || projectScopeChanged) {
      clearActivityFeedCache()
      clearActivityApiFeedCache()
    }

    void refreshScope()
  }, [refreshScope, viewerMemberId, projectScopeOnly])

  useEffect(() => {
    if (!isLoggedIn) {
      clearActivityFeedCache()
      clearActivityApiFeedCache()
      setScope(null)
      setCanFilterByProject(false)
      setSelectedMemberIdState("all")
      setProjectScopeOnlyState(false)
      clearAllActivityScopePreferences()
    }
  }, [isLoggedIn])

  const clearAllCache = useCallback(() => {
    clearActivityFeedCache()
    clearActivityApiFeedCache()
  }, [])

  useEffect(() => {
    const onPing = () => {
      if (!isActivityPageActive) return
      if (pingTimerRef.current) clearTimeout(pingTimerRef.current)
      pingTimerRef.current = setTimeout(() => {
        clearActivityFeedCache()
        clearActivityApiFeedCache()
        window.dispatchEvent(new Event("vt-activity-feed-invalidate"))
      }, PING_DEBOUNCE_MS)
    }
    window.addEventListener("vt-activity-ping", onPing)
    return () => {
      window.removeEventListener("vt-activity-ping", onPing)
      if (pingTimerRef.current) clearTimeout(pingTimerRef.current)
    }
  }, [isActivityPageActive])

  useEffect(() => {
    if (!isActivityPageActive || !isLoggedIn) return
    const poll = setInterval(() => {
      window.dispatchEvent(new CustomEvent("vt-activity-feed-invalidate", { detail: { staleOnly: true } }))
    }, POLL_MS)
    return () => clearInterval(poll)
  }, [isActivityPageActive, isLoggedIn])

  const buildQuery = useCallback(
    (type: ActivityFeedQuery["type"]): ActivityFeedQuery => ({
      type,
      memberId: selectedMemberId,
      projectScopeOnly,
    }),
    [selectedMemberId, projectScopeOnly],
  )

  const getCacheKey = useCallback(
    (query: ActivityFeedQuery, options?: { myTeamOnly?: boolean }) => {
      if (!viewerMemberId) return `${query.type}:anonymous`
      return buildActivityFeedCacheKey(viewerMemberId, query, options)
    },
    [viewerMemberId],
  )

  const readCache = useCallback((key: string) => readActivityFeedCache(key), [])
  const writeCache = useCallback((key: string, entry: ActivityFeedCacheEntry) => {
    writeActivityFeedCache(key, entry)
  }, [])
  const deleteCache = useCallback((key: string) => {
    deleteActivityFeedCache(key)
  }, [])

  const setProjectScopeOnly = useCallback((value: boolean) => {
    setProjectScopeOnlyState((prev) => {
      if (prev === value) return prev
      writeStoredProjectScopeOnly(value)
      clearActivityFeedCache()
      clearActivityApiFeedCache()
      return value
    })
  }, [])

  const value = useMemo<ActivityFeedContextValue>(
    () => ({
      scope,
      canFilterByProject,
      selectedMemberId,
      setSelectedMemberId,
      projectScopeOnly,
      setProjectScopeOnly,
      scopeLoading: scopeLoading && !scope,
      refreshScope,
      getCacheKey,
      readCache,
      writeCache,
      deleteCache,
      clearAllCache,
      isActivityPageActive,
      setActivityPageActive,
      buildQuery,
    }),
    [
      scope,
      canFilterByProject,
      selectedMemberId,
      setSelectedMemberId,
      projectScopeOnly,
      setProjectScopeOnly,
      scopeLoading,
      refreshScope,
      getCacheKey,
      readCache,
      writeCache,
      deleteCache,
      clearAllCache,
      isActivityPageActive,
      buildQuery,
    ],
  )

  return <ActivityFeedContext.Provider value={value}>{children}</ActivityFeedContext.Provider>
}
