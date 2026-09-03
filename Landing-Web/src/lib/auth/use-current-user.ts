"use client"

import { useEffect, useRef, useState } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { initFirebase, getFirebaseAuthClient } from "@/lib/firebase-client"
import { verifyIdTokenWithBackend, type AuthProfileSnapshot } from "@/lib/auth/verify-session"
import { syncSharedSessionCookie } from "@/lib/auth/session-cookie-sync"
import { consumeSuppressedAuthStateSync } from "@/lib/auth/auth-state-sync"
import { attemptCrossDomainSilentSignIn } from "@/lib/auth/cross-domain-sso"

export type CurrentUserState = {
  user: User | null | undefined
  profile: AuthProfileSnapshot | null
  memberId: string | null
  loading: boolean
  error: string | null
}

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ user: undefined, profile: null, memberId: null, loading: true, error: null })
  const syncedUidRef = useRef<string | null>(null)
  const ssoAttemptedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void initFirebase().then(() => {
      if (cancelled) return
      const auth = getFirebaseAuthClient()
      unsubscribe = onAuthStateChanged(auth, async (next) => {
        if (!next) {
          if (!ssoAttemptedRef.current) {
            ssoAttemptedRef.current = true
            if (await attemptCrossDomainSilentSignIn(auth)) return
          }
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
    }).catch((err: unknown) => {
      if (cancelled) return
      const message = err instanceof Error ? err.message : "Could not reach the authentication service."
      setState({ user: null, profile: null, memberId: null, loading: false, error: message })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return state
}
