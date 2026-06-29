/* eslint-disable react-doctor/exhaustive-deps */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  getFetchPromise,
  getLastFetchTime,
  hasCachedData,
  invalidateCache,
  readCache,
  setFetchPromise,
  touchFetchTime,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"

const DEFAULT_DEBOUNCE_MS = 2000
const DEFAULT_MIN_LOADING_MS = 900

export type CachedListRefetchOptions = {
  showLoading?: boolean
  forceRefetch?: boolean
}

export type UseCachedListOptions<T> = {
  cacheKey: string
  fetch: () => Promise<T>
  initialData?: T
  debounceMs?: number
  minLoadingMs?: number
  staleMs?: number
  showInitialLoading?: boolean
  refetchIntervalMs?: number
  refetchOnVisibility?: boolean
  presencePingEvent?: string
  backgroundRefetch?: CachedListRefetchOptions
  onError?: (error: unknown) => void
}

export type UseCachedListResult<T> = {
  data: T
  setData: (value: T | ((prev: T) => T)) => void
  isLoading: boolean
  refetch: (options?: CachedListRefetchOptions) => Promise<void>
  invalidate: () => void
}

export function useCachedList<T>({
  cacheKey,
  fetch,
  initialData,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minLoadingMs = DEFAULT_MIN_LOADING_MS,
  staleMs,
  showInitialLoading = true,
  refetchIntervalMs,
  refetchOnVisibility = false,
  presencePingEvent,
  backgroundRefetch,
  onError,
}: UseCachedListOptions<T>): UseCachedListResult<T> {
  const effectiveStaleMs =
    staleMs ?? (refetchIntervalMs && refetchIntervalMs > 0 ? Math.floor(refetchIntervalMs * 0.85) : undefined)
  const isMountedRef = useRef(true)
  const fetchRef = useRef(fetch)
  fetchRef.current = fetch

  const [data, setDataState] = useState<T>(() => {
    const cached = readCache<T>(cacheKey)
    if (cached !== null) return cached
    return (initialData ?? ([] as unknown)) as T
  })

  const [isLoading, setIsLoading] = useState(
    () => showInitialLoading && !hasCachedData(cacheKey),
  )

  const setData = useCallback(
    (value: T | ((prev: T) => T)) => {
      setDataState((prev) => {
        const next = typeof value === "function" ? (value as (p: T) => T)(prev) : value
        writeCache(cacheKey, next)
        return next
      })
    },
    [cacheKey],
  )

  const applyFromCache = useCallback(() => {
    const cached = readCache<T>(cacheKey)
    if (cached !== null) setDataState(cached)
  }, [cacheKey])

  const finishLoading = useCallback(
    (showLoading: boolean, startedAt: number) => {
      if (!hasCachedData(cacheKey)) {
        setIsLoading(true)
        return
      }
      if (!showLoading) {
        setIsLoading(false)
        return
      }
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, minLoadingMs - elapsed)
      setTimeout(() => {
        if (isMountedRef.current) setIsLoading(false)
      }, remaining)
    },
    [cacheKey, minLoadingMs],
  )

  const refetch = useCallback(
    async (options: CachedListRefetchOptions = {}): Promise<void> => {
      const showLoading = options.showLoading ?? false
      const forceRefetch = options.forceRefetch ?? false
      const startedAt = Date.now()
      const now = Date.now()

      const isStale =
        effectiveStaleMs !== undefined && now - getLastFetchTime(cacheKey) > effectiveStaleMs

      if (!forceRefetch && hasCachedData(cacheKey) && effectiveStaleMs !== undefined && !isStale) {
        applyFromCache()
        if (showLoading && isMountedRef.current) setIsLoading(false)
        return
      }

      if (!forceRefetch && (getFetchPromise(cacheKey) || now - getLastFetchTime(cacheKey) < debounceMs)) {
        const pending = getFetchPromise(cacheKey)
        if (pending) {
          await pending
          if (!isMountedRef.current) return
          applyFromCache()
          if (showLoading && hasCachedData(cacheKey)) setIsLoading(false)
        } else if (showLoading && hasCachedData(cacheKey) && isMountedRef.current) {
          setIsLoading(false)
        }
        return
      }

      if (showLoading && (!hasCachedData(cacheKey) || isStale) && isMountedRef.current) {
        setIsLoading(true)
      }

      const fetchTask = fetchRef
        .current()
        .then((next) => {
          writeCache(cacheKey, next)
        })
        .catch((err) => {
          onError?.(err)
        })
        .finally(() => {
          touchFetchTime(cacheKey)
          setFetchPromise(cacheKey, null)
        })

      setFetchPromise(cacheKey, fetchTask)

      await fetchTask
      if (!isMountedRef.current) return

      applyFromCache()
      finishLoading(showLoading, startedAt)
    },
    [applyFromCache, cacheKey, debounceMs, effectiveStaleMs, finishLoading, onError],
  )

  const invalidate = useCallback(() => {
    invalidateCache(cacheKey)
    const empty = (initialData ?? ([] as unknown)) as T
    setDataState(empty)
    setIsLoading(showInitialLoading)
  }, [cacheKey, initialData, showInitialLoading])

  useEffect(() => {
    isMountedRef.current = true
    void refetch({ showLoading: showInitialLoading })
    return () => {
      isMountedRef.current = false
    }
    // Initial load only — refetch identity is stable enough via fetchRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!refetchIntervalMs && !refetchOnVisibility && !presencePingEvent) return

    const runBackgroundRefetch = (): void => {
      void refetch(backgroundRefetch)
    }

    const intervalId =
      refetchIntervalMs && refetchIntervalMs > 0
        ? setInterval(runBackgroundRefetch, refetchIntervalMs)
        : null

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") runBackgroundRefetch()
    }

    if (refetchOnVisibility) {
      document.addEventListener("visibilitychange", onVisibility)
    }

    if (presencePingEvent) {
      window.addEventListener(presencePingEvent, runBackgroundRefetch)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
      if (refetchOnVisibility) document.removeEventListener("visibilitychange", onVisibility)
      if (presencePingEvent) window.removeEventListener(presencePingEvent, runBackgroundRefetch)
    }
  }, [backgroundRefetch, presencePingEvent, refetch, refetchIntervalMs, refetchOnVisibility])

  return { data, setData, isLoading, refetch, invalidate }
}
