/* eslint-disable react-doctor/exhaustive-deps */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  getFetchPromise,
  getLastFetchTime,
  hasCachedData,
  readCache,
  setFetchPromise,
  touchFetchTime,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"

const DEFAULT_DEBOUNCE_MS = 2000
const DEFAULT_MIN_LOADING_MS = 900
const LIST_FETCH_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

type ListFetcher<T> = {
  fetch: () => Promise<T>
}

export type CachedMultiListRefetchOptions = {
  showLoading?: boolean
  forceRefetch?: boolean
  /** When set, only these lists are fetched (defaults to all). */
  keys?: string[]
}

export type UseCachedMultiListOptions<T extends Record<string, unknown>> = {
  namespace: string
  lists: { [K in keyof T]: ListFetcher<T[K]> }
  loadingKey: keyof T & string
  initialData?: Partial<T>
  debounceMs?: number
  minLoadingMs?: number
  staleMs?: number
  refetchIntervalMs?: number
  refetchOnVisibility?: boolean
  presencePingEvent?: string
  /** Keys refreshed on interval / visibility (defaults to loadingKey only). */
  backgroundRefetchKeys?: (keyof T & string)[]
  backgroundRefetch?: CachedMultiListRefetchOptions
  onError?: (error: unknown) => void
}

export type UseCachedMultiListResult<T extends Record<string, unknown>> = {
  data: T
  setData: <K extends keyof T & string>(key: K, value: T[K] | ((prev: T[K]) => T[K])) => void
  isLoading: boolean
  refetch: (options?: CachedMultiListRefetchOptions) => Promise<void>
}

function cacheKey(namespace: string, key: string): string {
  return `${namespace}:${key}`
}

function metaKey(namespace: string): string {
  return `${namespace}:__meta__`
}

export function useCachedMultiList<T extends Record<string, unknown>>({
  namespace,
  lists,
  loadingKey,
  initialData,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minLoadingMs = DEFAULT_MIN_LOADING_MS,
  staleMs,
  refetchIntervalMs,
  refetchOnVisibility = false,
  presencePingEvent,
  backgroundRefetchKeys,
  backgroundRefetch,
  onError,
}: UseCachedMultiListOptions<T>): UseCachedMultiListResult<T> {
  const effectiveStaleMs =
    staleMs ?? (refetchIntervalMs && refetchIntervalMs > 0 ? Math.floor(refetchIntervalMs * 0.85) : 60_000)
  const listKeys = Object.keys(lists) as (keyof T & string)[]
  const bgKeys = backgroundRefetchKeys ?? [loadingKey]
  const isMountedRef = useRef(true)
  const listsRef = useRef(lists)
  listsRef.current = lists

  const readAllFromCache = useCallback((): T => {
    const out = {} as T
    for (const key of listKeys) {
      const cached = readCache<T[typeof key]>(cacheKey(namespace, key))
      const fallback = initialData?.[key]
      out[key] = (cached ?? fallback ?? ([] as unknown)) as T[typeof key]
    }
    return out
  }, [initialData, listKeys, namespace])

  const [data, setDataState] = useState<T>(readAllFromCache)
  const [isLoading, setIsLoading] = useState(() => !hasCachedData(cacheKey(namespace, loadingKey)))

  const applyFromCache = useCallback(() => {
    setDataState(readAllFromCache())
  }, [readAllFromCache])

  const setData = useCallback(
    <K extends keyof T & string>(key: K, value: T[K] | ((prev: T[K]) => T[K])) => {
      setDataState((prev) => {
        const nextValue =
          typeof value === "function" ? (value as (p: T[K]) => T[K])(prev[key]) : value
        writeCache(cacheKey(namespace, key), nextValue)
        return { ...prev, [key]: nextValue }
      })
    },
    [namespace],
  )

  const runFetch = useCallback(
    async (keys: (keyof T & string)[]): Promise<void> => {
      await withTimeout(
        Promise.allSettled(
          keys.map((key) =>
            listsRef.current[key]
              .fetch()
              .then((next) => {
                writeCache(cacheKey(namespace, key), next)
              })
              .catch((err) => {
                onError?.(err)
              }),
          ),
        ),
        LIST_FETCH_TIMEOUT_MS,
        "List fetch",
      ).catch((err) => {
        onError?.(err)
      })
      touchFetchTime(metaKey(namespace))
    },
    [namespace, onError],
  )

  const finishLoading = useCallback(
    (showLoading: boolean, startedAt: number) => {
      if (!hasCachedData(cacheKey(namespace, loadingKey))) {
        if (isMountedRef.current) setIsLoading(false)
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
    [loadingKey, minLoadingMs, namespace],
  )

  const refetch = useCallback(
    async (options: CachedMultiListRefetchOptions = {}): Promise<void> => {
      const showLoading = options.showLoading ?? false
      const forceRefetch = options.forceRefetch ?? false
      const keysToFetch = (options.keys ?? listKeys) as (keyof T & string)[]
      const startedAt = Date.now()
      const meta = metaKey(namespace)
      const loadingCacheKey = cacheKey(namespace, loadingKey)

      const inFlight = getFetchPromise(meta)
      if (inFlight) {
        await inFlight
        if (!isMountedRef.current) return
        applyFromCache()
        if (!forceRefetch) {
          finishLoading(showLoading, startedAt)
          return
        }
      }

      const now = Date.now()
      const isStale = now - getLastFetchTime(meta) > effectiveStaleMs

      if (
        !forceRefetch &&
        hasCachedData(loadingCacheKey) &&
        !isStale
      ) {
        applyFromCache()
        if (showLoading && isMountedRef.current) setIsLoading(false)
        return
      }

      if (!forceRefetch && now - getLastFetchTime(meta) < debounceMs) {
        applyFromCache()
        if (isMountedRef.current) setIsLoading(false)
        return
      }

      if (showLoading && (!hasCachedData(loadingCacheKey) || isStale) && isMountedRef.current) {
        setIsLoading(true)
      }

      const fetchTask = runFetch(keysToFetch).finally(() => {
        if (getFetchPromise(meta) === fetchTask) {
          setFetchPromise(meta, null)
        }
      })

      setFetchPromise(meta, fetchTask)

      try {
        await fetchTask
        if (!isMountedRef.current) return
        applyFromCache()
      } finally {
        if (isMountedRef.current) {
          finishLoading(showLoading, startedAt)
        }
      }
    },
    [
      applyFromCache,
      finishLoading,
      listKeys,
      loadingKey,
      namespace,
      debounceMs,
      runFetch,
      effectiveStaleMs,
    ],
  )

  useEffect(() => {
    isMountedRef.current = true
    void refetch()
    return () => {
      isMountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!refetchIntervalMs && !refetchOnVisibility && !presencePingEvent) return

    const runBackgroundRefetch = (): void => {
      void refetch({ keys: bgKeys, ...backgroundRefetch })
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
  }, [backgroundRefetch, bgKeys, presencePingEvent, refetch, refetchIntervalMs, refetchOnVisibility])

  return { data, setData, isLoading, refetch }
}
