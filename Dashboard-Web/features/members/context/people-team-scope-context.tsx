"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { useAuth } from "@/shared/providers/app"
import {
  fetchSharedTeamScopeMemberIds,
  readSharedTeamScopeMemberIds,
} from "@/features/members/services/people-team-scope"

const STORAGE_KEY = "vt:people-my-team-only"
const EMPTY_MEMBER_IDS = new Set<string>()

type PeopleTeamScopeContextValue = {
  canToggleMyTeam: boolean
  myTeamOnly: boolean
  setMyTeamOnly: (value: boolean) => void
  toggleMyTeamOnly: () => void
  teamMemberIds: Set<string>
  teamMemberIdsLoading: boolean
  refreshTeamMemberIds: () => Promise<void>
}

const PeopleTeamScopeContext = createContext<PeopleTeamScopeContextValue | null>(null)

const FALLBACK_VALUE: PeopleTeamScopeContextValue = {
  canToggleMyTeam: false,
  myTeamOnly: false,
  setMyTeamOnly: () => {},
  toggleMyTeamOnly: () => {},
  teamMemberIds: EMPTY_MEMBER_IDS,
  teamMemberIdsLoading: false,
  refreshTeamMemberIds: async () => {},
}

function readStoredMyTeamOnly(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function writeStoredMyTeamOnly(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value ? "1" : "0")
  } catch {
    // ignore
  }
}

export function PeopleTeamScopeProvider({ children }: { children: ReactNode }) {
  const { canSeeAllMembers } = usePermissions()
  const { memberId, sessionReady, isLoggedIn } = useAuth()
  const canToggleMyTeam = canSeeAllMembers

  const [myTeamOnly, setMyTeamOnlyState] = useState(() => readStoredMyTeamOnly())
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string>>(() => {
    if (!memberId) return EMPTY_MEMBER_IDS
    return readSharedTeamScopeMemberIds(memberId) ?? EMPTY_MEMBER_IDS
  })
  const [teamMemberIdsLoading, setTeamMemberIdsLoading] = useState(false)

  const loadedForMemberIdRef = useRef<string | null>(
    memberId && readSharedTeamScopeMemberIds(memberId) ? memberId : null,
  )
  const fetchGenerationRef = useRef(0)

  useEffect(() => {
    if (!canToggleMyTeam) {
      setMyTeamOnlyState(false)
      return
    }
    setMyTeamOnlyState(readStoredMyTeamOnly())
  }, [canToggleMyTeam])

  const setMyTeamOnly = useCallback((value: boolean) => {
    setMyTeamOnlyState(value)
    writeStoredMyTeamOnly(value)
  }, [])

  const toggleMyTeamOnly = useCallback(() => {
    setMyTeamOnlyState((current) => {
      const next = !current
      writeStoredMyTeamOnly(next)
      return next
    })
  }, [])

  const refreshTeamMemberIds = useCallback(
    async (options: { forceRefetch?: boolean } = {}) => {
      if (!canToggleMyTeam || !memberId || !sessionReady || !isLoggedIn) return

      const forceRefetch = options.forceRefetch ?? false
      if (!forceRefetch) {
        const cached = readSharedTeamScopeMemberIds(memberId)
        if (cached) {
          setTeamMemberIds(cached)
          loadedForMemberIdRef.current = memberId
          return
        }
      }

      const generation = ++fetchGenerationRef.current
      setTeamMemberIdsLoading(true)

      try {
        const ids = await fetchSharedTeamScopeMemberIds(memberId, { forceRefetch })
        if (generation !== fetchGenerationRef.current) return
        setTeamMemberIds(ids)
        loadedForMemberIdRef.current = memberId
      } catch (error) {
        if (generation !== fetchGenerationRef.current) return
        console.error("[People] Failed to fetch my-team scope:", error)
        setTeamMemberIds(EMPTY_MEMBER_IDS)
        loadedForMemberIdRef.current = null
      } finally {
        if (generation === fetchGenerationRef.current) {
          setTeamMemberIdsLoading(false)
        }
      }
    },
    [canToggleMyTeam, memberId, sessionReady, isLoggedIn],
  )

  useEffect(() => {
    if (!canToggleMyTeam || !memberId || !sessionReady || !isLoggedIn) {
      fetchGenerationRef.current += 1
      setTeamMemberIds(EMPTY_MEMBER_IDS)
      setTeamMemberIdsLoading(false)
      loadedForMemberIdRef.current = null
      return
    }

    const cached = readSharedTeamScopeMemberIds(memberId)
    if (cached) {
      setTeamMemberIds(cached)
      loadedForMemberIdRef.current = memberId
      return
    }

    if (loadedForMemberIdRef.current === memberId) return

    void refreshTeamMemberIds()
  }, [canToggleMyTeam, memberId, sessionReady, isLoggedIn, refreshTeamMemberIds])

  const value = useMemo(
    () => ({
      canToggleMyTeam,
      myTeamOnly: canToggleMyTeam ? myTeamOnly : false,
      setMyTeamOnly,
      toggleMyTeamOnly,
      teamMemberIds: canToggleMyTeam && myTeamOnly ? teamMemberIds : EMPTY_MEMBER_IDS,
      teamMemberIdsLoading,
      refreshTeamMemberIds: () => refreshTeamMemberIds({ forceRefetch: true }),
    }),
    [
      canToggleMyTeam,
      myTeamOnly,
      setMyTeamOnly,
      toggleMyTeamOnly,
      teamMemberIds,
      teamMemberIdsLoading,
      refreshTeamMemberIds,
    ],
  )

  return <PeopleTeamScopeContext.Provider value={value}>{children}</PeopleTeamScopeContext.Provider>
}

export function usePeopleTeamScope(): PeopleTeamScopeContextValue {
  const context = useContext(PeopleTeamScopeContext)
  return context ?? FALLBACK_VALUE
}
