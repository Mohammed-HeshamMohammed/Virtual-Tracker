"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useActivityFeedContext, type ActivityMemberOption } from "@/features/activity/components/activity-feed-context"
import { fetchActivityFeed, type ActivityFeedQuery } from "@/features/activity/services/activity-api"
import { useAuth } from "@/shared/providers/app"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"
import { isActivityFeedCacheFresh } from "@/features/activity/utils/activity-feed-cache"

export type { ActivityMemberOption }

type ReloadOptions = {
  silent?: boolean
  force?: boolean
}

/** Role-scoped activity feed with shared cache (screenshots / apps / urls). */
export function useActivityFeed<T>(type: "screenshots" | "apps" | "urls", options?: { day?: string }) {
  const feedDay = options?.day
  const { isLoggedIn, memberId: viewerMemberId } = useAuth()
  const { canToggleMyTeam, myTeamOnly } = usePeopleTeamScope()
  const {
    buildQuery,
    getCacheKey,
    readCache,
    writeCache,
    deleteCache,
    scopeLoading,
    isActivityPageActive,
  } = useActivityFeedContext()

  const teamScopeActive = canToggleMyTeam && myTeamOnly

  const resolveQuery = useCallback((): ActivityFeedQuery => {
    const base = buildQuery(type)
    if (!isActivityPageActive && viewerMemberId) {
      return { ...base, memberId: viewerMemberId, day: feedDay }
    }
    return { ...base, day: feedDay }
  }, [buildQuery, feedDay, isActivityPageActive, type, viewerMemberId])

  const cacheKey = useMemo(
    () => getCacheKey(resolveQuery(), { myTeamOnly: teamScopeActive }),
    [getCacheKey, resolveQuery, teamScopeActive],
  )

  const initialCache = readCache(cacheKey)
  const [data, setData] = useState<T | null>(() => (initialCache?.data as T) ?? null)
  const [members, setMembers] = useState<ActivityMemberOption[]>(() => initialCache?.members ?? [])
  const [loading, setLoading] = useState(() => !initialCache)
  const [error, setError] = useState<string | null>(null)
  const [disabledReason, setDisabledReason] = useState<string | null>(() => initialCache?.disabledReason ?? null)
  const fetchGenRef = useRef(0)

  const applyCache = useCallback((cached: ReturnType<typeof readCache>) => {
    if (!cached) return false
    setData(cached.data as T)
    setMembers(cached.members)
    setDisabledReason(cached.disabledReason)
    return true
  }, [])

  const reload = useCallback(
    async (reloadOptions?: ReloadOptions) => {
      if (!isLoggedIn) return

      const force = reloadOptions?.force === true
      const silent = reloadOptions?.silent === true
      const query = resolveQuery()
      const key = getCacheKey(query, { myTeamOnly: teamScopeActive })
      const cached = readCache(key)
      const cacheFresh = Boolean(cached && isActivityFeedCacheFresh(cached.fetchedAt))

      if (!force && cached) {
        applyCache(cached)
        setLoading(false)
        if (cacheFresh) return
      } else if (!silent && !cached) {
        setLoading(true)
      }

      if (scopeLoading && !cached && !force) return

      setError(null)
      const gen = ++fetchGenRef.current
      try {
        const result = await fetchActivityFeed<T>(query)
        if (gen !== fetchGenRef.current) return
        if (!result) {
          if (!cached) {
            setData(null)
            setMembers([])
            setDisabledReason(null)
            setError("Could not load activity data. Check your network connection or try again shortly.")
          }
          return
        }
        writeCache(key, {
          data: result.data,
          members: result.members,
          disabledReason: result.disabledReason ?? null,
          fetchedAt: Date.now(),
        })
        setData(result.data)
        setMembers(result.members)
        setDisabledReason(result.disabledReason ?? null)
      } catch {
        if (gen !== fetchGenRef.current) return
        if (!cached) setError("Failed to load activity data")
      } finally {
        if (gen === fetchGenRef.current) setLoading(false)
      }
    },
    [
      applyCache,
      getCacheKey,
      isLoggedIn,
      readCache,
      resolveQuery,
      scopeLoading,
      teamScopeActive,
      writeCache,
    ],
  )

  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    const cached = readCache(cacheKey)
    if (cached) {
      applyCache(cached)
      setLoading(false)
    } else if (!scopeLoading) {
      setLoading(true)
    }
  }, [applyCache, cacheKey, readCache, scopeLoading])

  useEffect(() => {
    if (!isLoggedIn) return
    if (scopeLoading && !readCache(cacheKey)) return
    void reloadRef.current()
  }, [cacheKey, isLoggedIn, readCache, scopeLoading])

  useEffect(() => {
    const onInvalidate = (event: Event) => {
      const staleOnly = (event as CustomEvent<{ staleOnly?: boolean }>).detail?.staleOnly === true
      const cached = readCache(cacheKey)
      if (staleOnly) {
        if (cached && isActivityFeedCacheFresh(cached.fetchedAt)) return
        void reloadRef.current({ silent: true })
        return
      }
      deleteCache(cacheKey)
      void reloadRef.current({ force: true })
    }
    window.addEventListener("vt-activity-feed-invalidate", onInvalidate)
    return () => window.removeEventListener("vt-activity-feed-invalidate", onInvalidate)
  }, [cacheKey, deleteCache, readCache])

  const showLoading = loading && data === null && error === null

  return { data, members, loading: showLoading, error, disabledReason, reload }
}
