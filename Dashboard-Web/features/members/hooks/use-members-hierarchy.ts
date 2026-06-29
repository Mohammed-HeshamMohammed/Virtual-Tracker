"use client"

import { useState, useEffect, useCallback } from "react"
import { getScopedHierarchyMembers } from "@/infrastructure/api"
import {
  getLastFetchTime,
  invalidateCache,
  readCache,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"
import type { ScopedHierarchyMembers } from "@/infrastructure/api"

const EMPTY_MEMBER_IDS = new Set<string>()
const SCOPED_CACHE_STALE_MS = 60_000

/** Bumped when backend splits visible vs manageable member scope. */
export const MEMBER_SCOPE_CACHE_PREFIX = "hierarchy-scope-v6-"

export function memberScopeCacheKey(memberId: string): string {
  return `${MEMBER_SCOPE_CACHE_PREFIX}${memberId}`
}

interface UseMemberScopeProps {
  canSeeAllMembers: boolean
  /** Backend-linked member id from auth — do not infer from cached list rows. */
  currentMemberId: string | undefined
  /** Wait until Firebase session + backend member are ready before calling scoped-members. */
  sessionReady?: boolean
}

function manageableFromScoped(result: ScopedHierarchyMembers): string[] {
  if (result.sees_all || !Array.isArray(result.members)) return []
  if (Array.isArray(result.manageable_members)) return result.manageable_members
  return []
}

function teamStaffableFromScoped(result: ScopedHierarchyMembers): string[] {
  if (result.sees_all || !Array.isArray(result.team_staffable_members)) return []
  return result.team_staffable_members
}

/**
 * Backend-authoritative People scope: who you can see vs who you can manage.
 */
export function useMemberScope({
  canSeeAllMembers,
  currentMemberId,
  sessionReady = true,
}: UseMemberScopeProps) {
  const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string>>(EMPTY_MEMBER_IDS)
  const [manageableMemberIds, setManageableMemberIds] = useState<Set<string>>(EMPTY_MEMBER_IDS)
  const [teamStaffableMemberIds, setTeamStaffableMemberIds] = useState<Set<string>>(EMPTY_MEMBER_IDS)
  const [scopeReloadToken, setScopeReloadToken] = useState(0)

  const refreshScope = useCallback(() => {
    if (currentMemberId) invalidateCache(memberScopeCacheKey(currentMemberId))
    setScopeReloadToken((token) => token + 1)
  }, [currentMemberId])

  const [prevCanSeeAllMembers, setPrevCanSeeAllMembers] = useState(canSeeAllMembers)
  const [prevCurrentMemberId, setPrevCurrentMemberId] = useState(currentMemberId)
  if (
    canSeeAllMembers !== prevCanSeeAllMembers ||
    currentMemberId !== prevCurrentMemberId
  ) {
    setPrevCanSeeAllMembers(canSeeAllMembers)
    setPrevCurrentMemberId(currentMemberId)
    if (canSeeAllMembers) {
      setVisibleMemberIds(EMPTY_MEMBER_IDS)
      setManageableMemberIds(EMPTY_MEMBER_IDS)
      setTeamStaffableMemberIds(EMPTY_MEMBER_IDS)
    }
  }

  useEffect(() => {
    if (canSeeAllMembers || !currentMemberId || !sessionReady) return

    let cancelled = false
    const cacheKey = memberScopeCacheKey(currentMemberId)
    const cached = readCache<ScopedHierarchyMembers>(cacheKey)
    const cacheFresh = Date.now() - getLastFetchTime(cacheKey) < SCOPED_CACHE_STALE_MS
    const cacheIncludesViewer =
      cached &&
      Array.isArray(cached.members) &&
      cached.members.includes(currentMemberId)

    if (cached && !cached.sees_all && cacheIncludesViewer && Array.isArray(cached.members)) {
      setVisibleMemberIds(new Set(cached.members))
      setManageableMemberIds(new Set(manageableFromScoped(cached)))
      setTeamStaffableMemberIds(new Set(teamStaffableFromScoped(cached)))
      if (cacheFresh) return
    }

    void getScopedHierarchyMembers()
      .then((result) => {
        if (cancelled) return
        if (result.sees_all || !Array.isArray(result.members)) {
          setVisibleMemberIds(new Set())
          setManageableMemberIds(new Set())
          setTeamStaffableMemberIds(new Set())
          return
        }
        setVisibleMemberIds(new Set(result.members))
        setManageableMemberIds(new Set(manageableFromScoped(result)))
        setTeamStaffableMemberIds(new Set(teamStaffableFromScoped(result)))
        writeCache(cacheKey, result)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes("Not authenticated")) return
        console.error("[People] Failed to fetch member scope:", err)
      })

    return () => {
      cancelled = true
    }
  }, [currentMemberId, canSeeAllMembers, sessionReady, scopeReloadToken])

  return {
    visibleMemberIds: canSeeAllMembers ? EMPTY_MEMBER_IDS : visibleMemberIds,
    manageableMemberIds: canSeeAllMembers ? EMPTY_MEMBER_IDS : manageableMemberIds,
    teamStaffableMemberIds: canSeeAllMembers ? EMPTY_MEMBER_IDS : teamStaffableMemberIds,
    refreshScope,
  }
}
