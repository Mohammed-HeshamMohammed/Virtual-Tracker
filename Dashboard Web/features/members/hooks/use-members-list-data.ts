"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { logSafeWarn } from "@/infrastructure/logging/logger"
import { getMembers } from "@/features/members/api/member-api"
import type { Member } from "@/features/members/models/member"
import type { MemberListFilters } from "@/features/members/components/filters/member-filters-panel"
import {
  getAddedColumnKeys,
  membersListCacheKey,
  membersListFieldSignature,
  resolveMembersListFields,
  fieldSetIncludes,
} from "@/features/members/utils/resolve-members-list-fields"
import {
  getLastFetchTime,
  hasCachedData,
  readCache,
  readMembersListCache,
  touchFetchTime,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"

const MEMBERS_META_KEY = "people-members:__members_meta__"
const STALE_MS = 300_000

type MembersListMeta = {
  fieldSignature: string
}

function readMembersMeta(): MembersListMeta | null {
  return readCache<MembersListMeta>(MEMBERS_META_KEY)
}

function writeMembersMeta(meta: MembersListMeta): void {
  writeCache(MEMBERS_META_KEY, meta)
}

type UseMembersListDataOptions = {
  enabledCols: Set<string>
  memberFilters: MemberListFilters
  sortCol: string | null
  /** When false, skips automatic fetch until session is authorized. */
  enabled?: boolean
}

export function useMembersListData({
  enabledCols,
  memberFilters,
  sortCol,
  enabled = true,
}: UseMembersListDataOptions) {
  const requestedFields = useMemo(
    () =>
      resolveMembersListFields({
        enabledCols,
        memberFilters,
        sortCol,
      }),
    [enabledCols, memberFilters, sortCol],
  )
  const fieldSignature = useMemo(() => membersListFieldSignature(requestedFields), [requestedFields])
  const storageKey = useMemo(() => membersListCacheKey(requestedFields), [requestedFields])

  const [members, setMembersState] = useState<Member[]>(() => {
    const cached = readCache<Member[]>(storageKey)
    if (cached) return cached
    return readMembersListCache() ?? []
  })
  const [isLoading, setIsLoading] = useState(() => !hasCachedData(storageKey) && members.length === 0)
  const [loadingCols, setLoadingCols] = useState<Set<string>>(new Set())

  const enabledColsRef = useRef(enabledCols)
  const loadedSignatureRef = useRef<string | null>(
    hasCachedData(storageKey) ? fieldSignature : readMembersMeta()?.fieldSignature ?? null,
  )
  const loadedFieldsRef = useRef<string[] | null>(
    hasCachedData(storageKey) ? requestedFields : null,
  )
  const fetchGenRef = useRef(0)

  const setMembers = useCallback(
    (value: Member[] | ((prev: Member[]) => Member[])) => {
      setMembersState((prev) => {
        const next = typeof value === "function" ? value(prev) : value
        writeCache(storageKey, next)
        writeMembersMeta({ fieldSignature })
        return next
      })
    },
    [fieldSignature, storageKey],
  )

  const fetchMembers = useCallback(async (): Promise<Member[]> => {
    return getMembers({ fields: requestedFields })
  }, [requestedFields])

  const refetch = useCallback(
    async (options: { forceRefetch?: boolean; showLoading?: boolean } = {}) => {
      if (!enabled) return
      const forceRefetch = options.forceRefetch ?? false
      const showLoading = options.showLoading ?? false
      const meta = readMembersMeta()
      const isStale = Date.now() - getLastFetchTime(MEMBERS_META_KEY) > STALE_MS

      if (!forceRefetch && hasCachedData(storageKey) && meta?.fieldSignature === fieldSignature && !isStale) {
        const cached = readCache<Member[]>(storageKey)
        if (cached) {
          setMembersState(cached)
          setIsLoading(false)
          setLoadingCols(new Set())
          return
        }
      }

      const previousEnabled = enabledColsRef.current
      const addedCols = getAddedColumnKeys(previousEnabled, enabledCols)
      const isColumnExpansion =
        loadedSignatureRef.current !== null &&
        loadedSignatureRef.current !== fieldSignature &&
        addedCols.length > 0

      if (isColumnExpansion) {
        setLoadingCols(new Set(addedCols))
      } else if (showLoading && members.length === 0) {
        setIsLoading(true)
      }

      enabledColsRef.current = enabledCols
      const generation = ++fetchGenRef.current

      try {
        const rows = await fetchMembers()
        if (generation !== fetchGenRef.current) return
        writeCache(storageKey, rows)
        writeMembersMeta({ fieldSignature })
        touchFetchTime(MEMBERS_META_KEY)
        loadedSignatureRef.current = fieldSignature
        loadedFieldsRef.current = requestedFields
        setMembersState(rows)
        setLoadingCols(new Set())
      } catch (error) {
        if (generation !== fetchGenRef.current) return
        logSafeWarn("[useMembersListData] Failed to fetch members", error)
      } finally {
        if (generation === fetchGenRef.current) {
          setIsLoading(false)
        }
      }
    },
    [enabled, enabledCols, fetchMembers, fieldSignature, storageKey],
  )

  useEffect(() => {
    if (!enabled) return
    enabledColsRef.current = enabledCols
    const loadedFields = loadedFieldsRef.current
    if (loadedFields && fieldSetIncludes(loadedFields, requestedFields)) {
      setLoadingCols(new Set())
      return
    }
    void refetch()
    // Refetch when the resolved API field set grows (column enable / filter / sort).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fieldSignature])

  return {
    members,
    setMembers,
    isLoading,
    loadingCols,
    requestedFields,
    fieldSignature,
    refetch,
  }
}
