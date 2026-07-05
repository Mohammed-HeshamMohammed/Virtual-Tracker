"use client"

import { useEffect, useRef, useState } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { initFirebase, getFirebaseAuthClient } from "@/lib/firebase-client"
import { verifyIdTokenWithBackend, type AuthProfileSnapshot } from "@/lib/auth/verify-session"
import { syncSharedSessionCookie } from "@/lib/auth/session-cookie-sync"
import { consumeSuppressedAuthStateSync } from "@/lib/auth/auth-state-sync"

export type CurrentUserState = {
  /** Undefined while Firebase/auth-state is still resolving. */
  user: User | null | undefined
  profile: AuthProfileSnapshot | null
  memberId: string | null
  loading: boolean
  error: string | null
}

/**
 * Central authority for Landing-Web's account area: observes Firebase auth
 * state and, on each new sign-in, verifies the ID token (Auth-Backend), then
 * bootstraps the session (Dashboard-Backend) and syncs the shared session
 * cookie — mirroring Dashboard-Web's onAuthStateChanged-driven flow.
 */
export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ user: undefined, profile: null, memberId: null, loading: true, error: null })
  const syncedUidRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void initFirebase().then(() => {
      if (cancelled) return
      unsubscribe = onAuthStateChanged(getFirebaseAuthClient(), async (next) => {
        if (!next) {
          syncedUidRef.current = null
          setState({ user: null, profile: null, memberId: null, loading: false, error: null })
          return
        }
        if (consumeSuppressedAuthStateSync()) return
        if (syncedUidRef.current === next.uid) {
          setState((prev) => ({ ...prev, user: next, loading: false }))
          return
        }
        setState((prev) => ({ ...prev, user: next, loading: true, error: null }))
        const result = await verifyIdTokenWithBackend(next)
        if (cancelled) return
        if (!result.success) {
          setState({ user: next, profile: null, memberId: null, loading: false, error: result.error })
          return
        }
        syncedUidRef.current = next.uid
        void syncSharedSessionCookie()
        setState({ user: next, profile: result.profile ?? null, memberId: result.memberId ?? null, loading: false, error: null })
      })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return state
}
