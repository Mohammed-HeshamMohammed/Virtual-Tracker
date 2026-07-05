/* eslint-disable react-doctor/exhaustive-deps */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import React, { createContext, useState as useComponentState, useEffect, useRef, ReactNode, useCallback, use } from "react"
import {
  type User,
  onAuthStateChanged,
  signInWithRedirect,
  signInWithPopup,
  OAuthProvider,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  reload,
  updateProfile,
} from "firebase/auth"
import { initFirebase, getFirebaseAuth } from "@/infrastructure/firebase/config"
import { logSafeWarn } from "@/infrastructure/logging/logger"
import { validatePasswordWithBackend } from "@/features/auth/api/validate-password-api"
import { clearFirebaseWebConfigCache, fetchFirebaseWebConfigFromBackend } from "@/features/auth/services/backend-config"
import { applyAuthPersistenceRememberMe } from "@/features/auth/services/auth-persistence"
import {
  AuthSessionInvalidatedError,
  handleSuspiciousAuthFailure,
  isSuspiciousAuthError,
  markAuthProjectBound,
  runPostAuthRedirectHygiene,
} from "@/features/auth/services/browser-state-hygiene"
import {
  cleanFirebaseAuthUrl,
  consumeAuthRedirectResultOnce,
  GOOGLE_REDIRECT_FAILED_MESSAGE,
  hasFirebaseAuthCallbackInUrl,
} from "@/features/auth/services/firebase-auth-bootstrap"
import { signInWithGoogleAccount } from "@/features/auth/services/google-sign-in"
import {
  broadcastAuthSessionReady,
  consumeLauncherOAuthIntent,
  GOOGLE_OAUTH_REDIRECT_MESSAGE,
  isLauncherHost,
  shouldUseGoogleRedirect,
  subscribeAuthSessionReady,
} from "@/features/auth"
import { verifyIdTokenWithBackend, type AuthProfileSnapshot } from "@/features/auth/services/verify-session"
import { RetriableBackendError, retryWithBackoff, isRetriableBackendError } from "@/infrastructure/api/retry"
import { fetchBootstrapSession, type BootstrapPayload } from "@/features/auth/services/bootstrap"
import { syncSharedSessionCookie, clearSharedSessionCookie } from "@/features/auth/services/session-cookie-sync"
import { AUTH_SYNC_RETRY, FIREBASE_INIT_RETRY } from "@/infrastructure/api/auth-retry"
import { fetchCurrentMemberWithFallback } from "@/features/members/api/member-api"
import { getMemberRoleLabel } from "@/features/auth"
import type { Member } from "@/features/members/models/member"
import { getFirebaseAuthContinueUrl } from "@/features/auth/services/auth-continue-url"
import { formatAuthError, isBenignAuthCancellation } from "@/features/auth/services/format-auth-error"
import {
  isEphemeralPhoneVerificationUser,
} from "@/features/auth/services/phone-verification-firebase"
import { isPhoneVerificationSessionActive } from "@/features/auth/services/phone-verification-session"
import { sendFirebasePasswordResetEmail } from "@/features/auth/services/password-reset"
import {
  sendVerificationEmailToUser,
  formatVerificationEmailError,
  EMAIL_NOT_VERIFIED_SIGN_IN_WARNING,
} from "@/features/auth/services/email-verification"
import { patchProfileSettingsWithBackend } from "@/features/auth/api/profile-settings-api"
import { validateNamePart } from "@/shared/validation/person-name"
import { validatePhoneField } from "@/shared/validation"
import { AuthGateError, isAuthGateError, isAccountRestrictionCode, VT_AUTH_SESSION_RESTRICTED } from "@/features/auth/services/auth-session-errors"
import { VT_EMAIL_FOR_SIGNIN, VT_REMEMBER_ME_FOR_SIGNIN } from "@/features/auth/services/storage-keys"
import { AuthErrorToastHost } from "@/shared/ui/layout"
import {
  assertCanRegisterWithEmailAndPassword,
  assertCanSendEmailSignInLink,
  assertCanSignInWithEmailAndPassword,
  describeExistingAccountGuidance,
  errorCodeOf,
  fetchSignInMethodsForEmailSafe,
  instructionWhenNoPasswordOnFile,
  isAccountExistsWithDifferentCredential,
  isAmbiguousEmailPasswordFailureCode,
  messageForAccountExistsWithDifferentCredential,
} from "@/features/auth/services/sign-in-method-guard"
import { isFirestoreQuotaExceededError } from "@/features/auth/services/firestore-quota"
import { prefetchAuthBootResources } from "@/features/auth/services/auth-boot-prefetch"
import { checkAllBackendsReady } from "@/features/auth/services/backend-availability"
import {
  BACKEND_CONNECTION_LOST,
  BACKEND_CONNECTION_RESTORED,
  BACKEND_RECONNECTING_TITLE,
  BACKEND_UNAVAILABLE_MESSAGE,
  BACKEND_UNAVAILABLE_TIMEOUT_MESSAGE,
  notifyBackendConnectionRestored,
  serviceConnectingAttemptMessage,
  serviceReconnectAttemptMessage,
} from "@/infrastructure/api/backend-connection-events"
import {
  infrastructureErrorMessage,
  isInfrastructureError,
  isServiceUnavailableError,
} from "@/features/auth/services/service-unavailable"

export interface AuthContextType {
  user: User | null
  /** True only after Firebase auth AND successful backend `/api/auth/verify` authorization. */
  isLoggedIn: boolean
  /** Firestore `User_profiles/{uid}` snapshot from the last successful `/api/auth/verify` (same UID as Auth). */
  profile: AuthProfileSnapshot | null
  /** True while Firebase init or an auth-state sync (verify + member) is in flight. */
  loading: boolean
  /** False until the first auth bootstrap pass finished (safe to render role-aware shell). */
  sessionReady: boolean
  /** Human-readable session bootstrap message (loading / reconnecting). */
  sessionStatusMessage: string | null
  /** Set when verify/bootstrap cannot reach the server; user may retry without re-entering credentials. */
  sessionConnectionError: string | null
  retrySessionSync: () => Promise<void>
  /** True while backend verify is retrying after a transient failure. */
  backendReconnecting: boolean
  appInitialized: boolean
  appInitProgress: string
  appInitPercent: number
  appInitError: string | null
  retryInit: () => Promise<void>
  /** Firestore `members` row for the signed-in user (loaded during bootstrap). */
  currentMember: Member | null
  /** Primary role name from `members` / `member_roles` (default `User`). */
  memberRole: string
  memberId: string | undefined
  /** Lightweight counts from GET /api/bootstrap for shell hints. */
  dashboardSummary: BootstrapPayload["dashboardSummary"] | null
  initError: string | null
  retryConnection: () => void
  authError: string | null
  clearAuthError: () => void
  resetAuthGateMessages: () => void
  cancelPendingOAuthSignIn: () => void
  signInWithGoogle: (rememberMe?: boolean) => Promise<void>
  signInWithApple: (rememberMe?: boolean) => Promise<void>
  signInWithEmailPassword: (email: string, password: string, rememberMe?: boolean) => Promise<void>
  registerWithEmailPassword: (
    email: string,
    password: string,
    options?: { firstName?: string; lastName?: string; phone?: string; rememberMe?: boolean },
  ) => Promise<void>
  sendWorkEmailLink: (email: string, rememberMe?: boolean) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  logout: () => Promise<void>
  /** Reloads the Firebase user and re-syncs `profile` from `/api/auth/verify` (e.g. after avatar upload). */
  refreshProfile: () => Promise<void>
  /** Set when sign-in is blocked pending email verification (auth page only). */
  verificationGate: { email: string; password: string } | null
  clearVerificationGate: () => void
  resendVerificationEmail: () => Promise<void>
  verificationGateMessage: string | null
  verificationGateError: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = use(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

type SyncBackendResult = {
  profile?: AuthProfileSnapshot
  memberId?: string
}

function isInfrastructureSessionError(error: unknown): boolean {
  return (
    isFirestoreQuotaExceededError(error) ||
    isServiceUnavailableError(error) ||
    isInfrastructureError(error)
  )
}

async function syncBackend(
  user: User,
  onRetry?: (attempt: number) => void,
  signal?: AbortSignal,
): Promise<SyncBackendResult> {
  try {
    return await retryWithBackoff(
      async () => {
        const result = await verifyIdTokenWithBackend(user)
        if (!result.success) {
          if (isSuspiciousAuthError(result.error)) {
            await handleSuspiciousAuthFailure()
            throw new AuthSessionInvalidatedError()
          }
          if (result.code) {
            throw new AuthGateError(result.error || "Backend verify failed", result.code)
          }
          const errText = result.error || "Backend verify failed"
          if (isRetriableBackendError(errText)) {
            throw new RetriableBackendError(errText)
          }
          throw new Error(errText)
        }
        const config = await fetchFirebaseWebConfigFromBackend()
        if (config.projectId) markAuthProjectBound(config.projectId)
        return { profile: result.profile, memberId: result.memberId }
      },
      {
        minDurationMs: AUTH_SYNC_RETRY.minDurationMs,
        initialDelayMs: AUTH_SYNC_RETRY.initialDelayMs,
        maxDelayMs: AUTH_SYNC_RETRY.maxDelayMs,
        backoffFactor: AUTH_SYNC_RETRY.backoffFactor,
        signal,
        isRetriable: (error) =>
          error instanceof RetriableBackendError ||
          isServiceUnavailableError(error) ||
          (isRetriableBackendError(error) &&
            !(error instanceof AuthSessionInvalidatedError) &&
            !isFirestoreQuotaExceededError(error) &&
            !isInfrastructureError(error)),
        onRetry: (attempt, delayMs, error) => {
          logSafeWarn(`[AuthProvider] Backend verify retry #${attempt} in ${delayMs}ms`, error)
          onRetry?.(attempt)
        },
      },
    )
  } catch (e) {
    if (e instanceof AuthSessionInvalidatedError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (isSuspiciousAuthError(msg)) await handleSuspiciousAuthFailure()
    throw e
  }
}

const RECONNECT_TIMEOUT_MS = 15_000
const SESSION_ROLE_SYNC_MS = 45_000

function memberRoleLabel(member: Member | null | undefined): string {
  if (!member) return ""
  return (member.role_name || member.role || "").trim()
}

function isReconnectAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useComponentState<User | null>(null)
  const [profile, setProfile] = useComponentState<AuthProfileSnapshot | null>(null)
  const [currentMember, setCurrentMember] = useComponentState<Member | null>(null)
  const [loading, setLoading] = useComponentState(true)
  const [sessionReady, setSessionReady] = useComponentState(false)
  const [sessionStatusMessage, setSessionStatusMessage] = useComponentState<string | null>(null)
  const [sessionConnectionError, setSessionConnectionError] = useComponentState<string | null>(null)
  const [backendReconnecting, setBackendReconnecting] = useComponentState(false)
  const [appInitialized, setAppInitialized] = useComponentState(false)
  const [appInitProgress, setAppInitProgress] = useComponentState("Loading workspace...")
  const [appInitPercent, setAppInitPercent] = useComponentState(0)
  const [appInitError, setAppInitError] = useComponentState<string | null>(null)
  const [dashboardSummary, setDashboardSummary] = useComponentState<BootstrapPayload["dashboardSummary"] | null>(null)

  const [initError, setInitError] = useComponentState<string | null>(null)
  const [connectionAttempt, setConnectionAttempt] = useComponentState(0)
  const [authError, setAuthError] = useComponentState<string | null>(null)
  const [sessionAuthorized, setSessionAuthorized] = useComponentState(false)
  const [verificationGate, setVerificationGate] = useComponentState<{ email: string; password: string } | null>(null)
  const [verificationGateMessage, setVerificationGateMessage] = useComponentState<string | null>(null)
  const [verificationGateError, setVerificationGateError] = useComponentState<string | null>(null)
  const clearAuthError = useCallback(() => setAuthError(null), [])
  const resetAuthGateMessages = useCallback(() => {
    setAuthError(null)
    setInitError(null)
    setSessionConnectionError(null)
  }, [])
  const retrySessionSyncRef = useRef<(() => Promise<void>) | null>(null)
  const reconnectAbortRef = useRef<AbortController | null>(null)
  const signOutForAccountRestrictionRef = useRef<(message: string) => Promise<void>>(async () => {})
  const pendingSignInCredentialsRef = useRef<{ email: string; password: string } | null>(null)
  const skipNextAuthStateSyncRef = useRef(false)
  const registrationSyncSuppressedRef = useRef(false)
  const sessionSyncUserRef = useRef<User | null>(null)
  const sessionReadyRef = useRef(false)
  const sessionAuthorizedRef = useRef(false)
  const currentMemberRef = useRef<Member | null>(null)

  useEffect(() => {
    currentMemberRef.current = currentMember
  }, [currentMember])

  const signOutForAccountRestriction = useCallback(async (message: string) => {
    setSessionAuthorized(false)
    setSessionConnectionError(null)
    setBackendReconnecting(false)
    setSessionStatusMessage(null)
    setAuthError(message)
    setProfile(null)
    setCurrentMember(null)
    setDashboardSummary(null)
    skipNextAuthStateSyncRef.current = true
    void clearSharedSessionCookie()
    const auth = getFirebaseAuth()
    await firebaseSignOut(auth).catch(() => {})
    setUser(null)
    sessionSyncUserRef.current = null
  }, [])

  const syncSessionFromBootstrap = useCallback(async () => {
    if (!sessionAuthorizedRef.current || !sessionSyncUserRef.current) return
    try {
      const { member, payload } = await fetchBootstrapSession()
      const previousRole = memberRoleLabel(currentMemberRef.current)
      const nextRole = memberRoleLabel(member)
      setCurrentMember(member)
      setDashboardSummary(payload.dashboardSummary)
      if (previousRole && nextRole && previousRole !== nextRole) {
        const { invalidatePeopleMemberCaches } = await import("@/shared/tables/hooks/list-cache-registry")
        invalidatePeopleMemberCaches(member.id)
      }
    } catch (error) {
      if (isAuthGateError(error) && isAccountRestrictionCode(error.code)) {
        await signOutForAccountRestriction(error.message)
      }
    }
  }, [signOutForAccountRestriction])

  signOutForAccountRestrictionRef.current = signOutForAccountRestriction

  useEffect(() => {
    sessionReadyRef.current = sessionReady
  }, [sessionReady])

  useEffect(() => {
    sessionAuthorizedRef.current = sessionAuthorized
  }, [sessionAuthorized])

  useEffect(() => {
    const onRestricted = (event: Event) => {
      if (!sessionAuthorizedRef.current) return
      const detail = (event as CustomEvent<{ message?: string }>).detail
      void signOutForAccountRestriction(
        detail?.message || "Your account access has been restricted.",
      )
    }

    window.addEventListener(VT_AUTH_SESSION_RESTRICTED, onRestricted)
    return () => window.removeEventListener(VT_AUTH_SESSION_RESTRICTED, onRestricted)
  }, [signOutForAccountRestriction])

  useEffect(() => {
    if (!sessionAuthorized || !user || profile?.mustChangePassword) return

    const onFocus = () => {
      void syncSessionFromBootstrap()
    }
    const intervalId = window.setInterval(() => {
      void syncSessionFromBootstrap()
    }, SESSION_ROLE_SYNC_MS)

    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.clearInterval(intervalId)
    }
  }, [sessionAuthorized, user, profile?.mustChangePassword, syncSessionFromBootstrap])

  useEffect(() => {
    const onConnectionLost = (event: Event) => {
      if (!sessionReadyRef.current || !sessionAuthorizedRef.current) return
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setSessionConnectionError(detail?.message ?? BACKEND_UNAVAILABLE_MESSAGE)
      setBackendReconnecting(false)
    }

    const onConnectionRestored = () => {
      if (!sessionReadyRef.current || !sessionAuthorizedRef.current) return
      setSessionConnectionError(null)
      setBackendReconnecting(false)
    }

    window.addEventListener(BACKEND_CONNECTION_LOST, onConnectionLost)
    window.addEventListener(BACKEND_CONNECTION_RESTORED, onConnectionRestored)
    return () => {
      window.removeEventListener(BACKEND_CONNECTION_LOST, onConnectionLost)
      window.removeEventListener(BACKEND_CONNECTION_RESTORED, onConnectionRestored)
    }
  }, [])

  const doInitialization = useCallback(async (_member: Member | null) => {
    setAppInitialized(true)
    setAppInitError(null)
    setAppInitProgress("Ready")
    setAppInitPercent(100)
  }, [])

  const retryInit = useCallback(async () => {
    await doInitialization(currentMember)
  }, [doInitialization, currentMember])

  const completeSessionAfterVerify = useCallback(
    async (nextProfile: AuthProfileSnapshot | undefined, memberId?: string) => {
      setProfile(nextProfile ?? null)
      setAuthError(null)
      setVerificationGate(null)
      setVerificationGateMessage(null)
      setVerificationGateError(null)
      setSessionConnectionError(null)

      const mustChangePassword = nextProfile?.mustChangePassword === true
      if (mustChangePassword) {
        setSessionAuthorized(true)
        setCurrentMember(null)
        setDashboardSummary(null)
        setAppInitPercent(100)
        setAppInitialized(true)
        return
      }

      try {
        const { member, payload } = await fetchBootstrapSession()
        setCurrentMember(member)
        setDashboardSummary(payload.dashboardSummary)
        await doInitialization(member)
      } catch (bootstrapErr) {
        if (isAuthGateError(bootstrapErr) && isAccountRestrictionCode(bootstrapErr.code)) {
          throw bootstrapErr
        }
        logSafeWarn("[AuthProvider] bootstrap session fetch failed; falling back to member/current", bootstrapErr)
        const member = await fetchCurrentMemberWithFallback(memberId)
        setCurrentMember(member)
        setDashboardSummary(null)
        await doInitialization(member)
      }

      setSessionAuthorized(true)
      void syncSharedSessionCookie()
      void import("@/features/auth/services/presence-ws").then(({ connectPresenceWebSocket, sendPresenceActivity }) => {
        void connectPresenceWebSocket().then((ok) => {
          if (ok) sendPresenceActivity()
        })
      })
      void import("@/features/auth/services/presence-events-sse").then(({ openPresenceEventStream }) => {
        void openPresenceEventStream()
      })
    },
    [doInitialization],
  )

  const deliverVerificationEmailForUser = useCallback(
    async (
      firebaseUser: User,
      gate: { email: string; password: string },
      options?: { initialMessage?: string },
    ) => {
      setVerificationGate(gate)
      setVerificationGateError(null)
      setVerificationGateMessage(options?.initialMessage ?? null)
      try {
        await sendVerificationEmailToUser(firebaseUser)
        setVerificationGateMessage("Verification email sent. Check your inbox and spam folder.")
      } catch (err) {
        setVerificationGateError(formatVerificationEmailError(err))
      }
    },
    [],
  )

  const clearReconnectUi = useCallback(() => {
    setBackendReconnecting(false)
    setSessionStatusMessage(null)
    setLoading(false)
  }, [])

  const retrySessionSync = useCallback(async () => {
    const pendingUser = sessionSyncUserRef.current
    if (!pendingUser) {
      clearReconnectUi()
      return
    }

    reconnectAbortRef.current?.abort()
    const controller = new AbortController()
    reconnectAbortRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), RECONNECT_TIMEOUT_MS)

    setBackendReconnecting(true)
    setSessionStatusMessage(
      sessionAuthorizedRef.current ? BACKEND_RECONNECTING_TITLE : "Signing you in...",
    )
    setLoading(true)
    try {
      const { profile: nextProfile, memberId } = await syncBackend(
        pendingUser,
        (attempt) => {
          setBackendReconnecting(true)
          setSessionStatusMessage(serviceReconnectAttemptMessage(attempt))
        },
        controller.signal,
      )
      setSessionConnectionError(null)
      setInitError(null)
      await completeSessionAfterVerify(nextProfile, memberId)
    } catch (e) {
      if (e instanceof AuthSessionInvalidatedError) {
        setSessionAuthorized(false)
        setUser(null)
        setProfile(null)
        setCurrentMember(null)
        setDashboardSummary(null)
        setSessionConnectionError(null)
        return
      }
      if (isAuthGateError(e) && isAccountRestrictionCode(e.code)) {
        await signOutForAccountRestriction(e.message)
        return
      }
      if (isAuthGateError(e) && e.code === "RATE_LIMITED") {
        // Fail fast with a manual retry instead of auto-looping — retries would
        // themselves count against the same rate-limit window and prolong it.
        setSessionConnectionError(e.message || "Too many requests. Please wait a moment and try again.")
        setAuthError(null)
        return
      }
      if (isReconnectAbortError(e)) {
        setSessionConnectionError(BACKEND_UNAVAILABLE_TIMEOUT_MESSAGE)
        setAuthError(null)
        return
      }
      if (isInfrastructureSessionError(e)) {
        setInitError(infrastructureErrorMessage(e))
        setAuthError(null)
        setSessionConnectionError(null)
        return
      }
      const retriable = isRetriableBackendError(e)
      if (retriable) {
        setSessionConnectionError(BACKEND_UNAVAILABLE_MESSAGE)
        return
      }
      setSessionAuthorized(false)
      const msg = e instanceof Error ? e.message : "Profile sync failed"
      setAuthError(msg)
      setSessionConnectionError(null)
      setProfile(null)
      setCurrentMember(null)
      setDashboardSummary(null)
    } finally {
      window.clearTimeout(timeoutId)
      reconnectAbortRef.current = null
      setBackendReconnecting(false)
      setSessionStatusMessage(null)
      setLoading(false)
      setSessionReady(true)
    }
  }, [clearReconnectUi, completeSessionAfterVerify, signOutForAccountRestriction])

  retrySessionSyncRef.current = retrySessionSync

  const retryConnection = useCallback(() => {
    setAuthError(null)

    if (sessionReadyRef.current && sessionAuthorizedRef.current) {
      setBackendReconnecting(true)
      void (async () => {
        try {
          const readiness = await checkAllBackendsReady()
          if (readiness.ok) {
            notifyBackendConnectionRestored()
            setSessionConnectionError(null)
            setInitError(null)
          } else {
            setSessionConnectionError(readiness.error)
          }
        } finally {
          setBackendReconnecting(false)
        }
      })()
      return
    }

    setSessionStatusMessage(BACKEND_RECONNECTING_TITLE)
    setLoading(true)
    if (sessionSyncUserRef.current) {
      void retrySessionSyncRef.current?.()
      return
    }
    setConnectionAttempt((attempt) => attempt + 1)
  }, [])

  /** Avoid overlapping OAuth popups (double-clicks, etc.). */
  const oauthPopupLockRef = useRef(false)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    ; (async () => {
      const readiness = await prefetchAuthBootResources()
      if (!readiness.ok) {
        if (!cancelled) {
          setInitError(readiness.error)
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          setLoading(false)
          setSessionReady(true)
        }
        return
      }

      let webConfig: Awaited<ReturnType<typeof fetchFirebaseWebConfigFromBackend>> | undefined
      let lastInitError: unknown
      try {
        webConfig = await retryWithBackoff(
          async () => {
            const config = await fetchFirebaseWebConfigFromBackend()
            await initFirebase()
            return config
          },
          {
            minDurationMs: FIREBASE_INIT_RETRY.minDurationMs,
            initialDelayMs: FIREBASE_INIT_RETRY.initialDelayMs,
            maxDelayMs: FIREBASE_INIT_RETRY.maxDelayMs,
            backoffFactor: FIREBASE_INIT_RETRY.backoffFactor,
            onRetry: (attempt, delayMs, error) => {
              logSafeWarn(`[AuthProvider] Firebase init retry #${attempt} in ${delayMs}ms`, error)
              if (!cancelled) {
                setSessionStatusMessage(serviceConnectingAttemptMessage(attempt))
              }
            },
          },
        )
      } catch (e) {
        lastInitError = e
      }
      if (!webConfig) {
        if (!cancelled) {
          const msg = lastInitError instanceof Error ? lastInitError.message : BACKEND_UNAVAILABLE_MESSAGE
          logSafeWarn("Auth initialization failed.", lastInitError)
          setInitError(msg)
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          setLoading(false)
          setSessionReady(true)
        }
        return
      }
      if (cancelled) return

      const auth = getFirebaseAuth()

      /** Register before redirect completion so the session is observed as soon as Google returns. */
      unsubscribe = onAuthStateChanged(auth, async (next) => {
        if (!next) {
          setUser(null)
          sessionSyncUserRef.current = null
          setProfile(null)
          setCurrentMember(null)
          setDashboardSummary(null)
          setDashboardSummary(null)
          setSessionAuthorized(false)
          setAppInitialized(false)
          setAppInitPercent(0)
          void import("@/shared/tables/hooks/list-cache-registry").then(({ clearAllListCaches }) =>
            clearAllListCaches(),
          )
          setLoading(false)
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          setSessionReady(true)
          return
        }
        if (isPhoneVerificationSessionActive() || isEphemeralPhoneVerificationUser(next)) {
          return
        }
        if (skipNextAuthStateSyncRef.current || registrationSyncSuppressedRef.current) {
          skipNextAuthStateSyncRef.current = false
          return
        }
        const previousUid = sessionSyncUserRef.current?.uid
        setUser(next)
        sessionSyncUserRef.current = next
        if (sessionAuthorizedRef.current && previousUid === next.uid) {
          setLoading(false)
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          if (!sessionReadyRef.current) setSessionReady(true)
          return
        }
        const resumingSameFirebaseUser = previousUid === next.uid
        if (resumingSameFirebaseUser) {
          setBackendReconnecting(true)
          setSessionStatusMessage(BACKEND_RECONNECTING_TITLE)
        } else {
          setLoading(true)
          setSessionReady(false)
          setSessionStatusMessage("Signing you in...")
        }
        setSessionConnectionError(null)
        if (!resumingSameFirebaseUser) {
          setBackendReconnecting(false)
        }
        try {
          const { profile: nextProfile, memberId } = await syncBackend(next, (attempt) => {
            setBackendReconnecting(true)
            setSessionStatusMessage(serviceReconnectAttemptMessage(attempt))
          })
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          await completeSessionAfterVerify(nextProfile, memberId)
          setSessionConnectionError(null)
          setInitError(null)
          if (isLauncherHost() && !window.pywebview?.api) {
            broadcastAuthSessionReady()
          }
        } catch (e) {
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          if (e instanceof AuthSessionInvalidatedError) {
            setSessionAuthorized(false)
            setUser(null)
            setProfile(null)
            setCurrentMember(null)
            setDashboardSummary(null)
            setAuthError(null)
            setSessionConnectionError(null)
            setLoading(false)
            setSessionReady(true)
            return
          }
          if (isAuthGateError(e) && e.code === "EMAIL_NOT_VERIFIED") {
            const creds = pendingSignInCredentialsRef.current
            pendingSignInCredentialsRef.current = null
            const gate = creds ?? { email: next.email?.trim() ?? "", password: "" }
            const warningMessage = e.message?.trim() || EMAIL_NOT_VERIFIED_SIGN_IN_WARNING
            if (gate.email) {
              if (creds) {
                await deliverVerificationEmailForUser(next, gate, { initialMessage: warningMessage })
              } else {
                setVerificationGate(gate)
                setVerificationGateError(null)
                setVerificationGateMessage(warningMessage)
              }
              setAuthError(null)
            } else {
              setAuthError(warningMessage)
            }
            skipNextAuthStateSyncRef.current = true
            await firebaseSignOut(auth)
            setUser(null)
            setProfile(null)
            setCurrentMember(null)
            setDashboardSummary(null)
            setSessionConnectionError(null)
            setLoading(false)
            setSessionReady(true)
            return
          }
          if (isAuthGateError(e) && isAccountRestrictionCode(e.code)) {
            await signOutForAccountRestrictionRef.current(e.message)
            setLoading(false)
            setSessionReady(true)
            return
          }
          if (isAuthGateError(e) && e.code === "NO_MEMBER_PROFILE") {
            const usedOAuth = next.providerData.some(
              (provider) => provider.providerId === "google.com" || provider.providerId === "apple.com",
            )
            const msg = usedOAuth
              ? "No Virtual Tracker account is linked to this sign-in. Ask your administrator for access, or use Request Now on the sign-in page."
              : e.message
            setSessionAuthorized(false)
            skipNextAuthStateSyncRef.current = true
            await firebaseSignOut(auth).catch(() => {})
            setUser(null)
            setAuthError(msg)
            setSessionConnectionError(null)
            setProfile(null)
            setCurrentMember(null)
            setDashboardSummary(null)
            setLoading(false)
            setSessionReady(true)
            return
          }
          const msg = e instanceof Error ? e.message : "Profile sync failed"
          const retriable = isRetriableBackendError(e)
          if (retriable) {
            logSafeWarn("[AuthProvider] verify / profile sync failed after retries:", e)
            setSessionConnectionError(BACKEND_UNAVAILABLE_MESSAGE)
            setAuthError(null)
            return
          }
          if (isInfrastructureSessionError(e)) {
            logSafeWarn("[AuthProvider] verify / profile sync unavailable:", e)
            setInitError(infrastructureErrorMessage(e))
            setAuthError(null)
            setSessionConnectionError(null)
            setProfile(null)
            setCurrentMember(null)
            setDashboardSummary(null)
            return
          }
          setSessionAuthorized(false)
          skipNextAuthStateSyncRef.current = true
          await firebaseSignOut(auth).catch(() => {})
          setUser(null)
          logSafeWarn("[AuthProvider] verify / profile sync error:", e)
          setAuthError(msg)
          setSessionConnectionError(null)
          setProfile(null)
          setCurrentMember(null)
          setDashboardSummary(null)
        } finally {
          setLoading(false)
          setBackendReconnecting(false)
          setSessionStatusMessage(null)
          setSessionReady(true)
        }
      })

      if (cancelled) return

      try {
        const redirectCred = await consumeAuthRedirectResultOnce(auth)
        if (redirectCred?.user) {
          cleanFirebaseAuthUrl()
        } else if (!cancelled && hasFirebaseAuthCallbackInUrl()) {
          cleanFirebaseAuthUrl()
          setAuthError(GOOGLE_REDIRECT_FAILED_MESSAGE)
        }
      } catch (e) {
        if (!cancelled) {
          if (isBenignAuthCancellation(e)) {
            /* user closed popup or switched sign-in method */
          } else if (isAccountExistsWithDifferentCredential(e)) {
            const m = await messageForAccountExistsWithDifferentCredential(auth, e)
            setAuthError(m)
          } else {
            const msg = formatAuthError(e)
            if (msg) setAuthError(msg)
          }
        }
      }

      if (cancelled) return

      const rememberFlag =
        typeof window !== "undefined" ? window.localStorage.getItem(VT_REMEMBER_ME_FOR_SIGNIN) : null
      await applyAuthPersistenceRememberMe(auth, rememberFlag !== "0")

      const launcherOAuthIntent = consumeLauncherOAuthIntent()
      if (launcherOAuthIntent === "google" && !auth.currentUser) {
        try {
          setSessionStatusMessage(GOOGLE_OAUTH_REDIRECT_MESSAGE)
          const provider = new GoogleAuthProvider()
          provider.setCustomParameters({ prompt: "select_account" })
          await signInWithRedirect(auth, provider)
        } catch (e) {
          if (!cancelled && !isBenignAuthCancellation(e)) {
            const msg = formatAuthError(e)
            if (msg) setAuthError(msg)
          }
        }
      }

      if (cancelled) return

      if (typeof window !== "undefined" && isSignInWithEmailLink(auth, window.location.href)) {
        const stored = window.localStorage.getItem(VT_EMAIL_FOR_SIGNIN)
        const email =
          stored ||
          window.prompt("Confirm your work email to finish signing in (same address you used before):")?.trim() ||
          ""
        if (email) {
          const methods = await fetchSignInMethodsForEmailSafe(auth, email)
          try {
            assertCanUseEmailLinkCompletion(methods, email)
            const rememberFlag = window.localStorage.getItem(VT_REMEMBER_ME_FOR_SIGNIN)
            const rememberMe = rememberFlag !== "0"
            await applyAuthPersistenceRememberMe(auth, rememberMe)
            await signInWithEmailLink(auth, email, window.location.href)
            window.localStorage.removeItem(VT_EMAIL_FOR_SIGNIN)
            window.localStorage.removeItem(VT_REMEMBER_ME_FOR_SIGNIN)
            window.history.replaceState({}, document.title, window.location.pathname)
          } catch (e) {
            if (!cancelled) {
              setAuthError(e instanceof Error ? e.message : formatAuthError(e))
            }
          }
        }
      }

      if (!cancelled) {
        runPostAuthRedirectHygiene(webConfig)
      }
    })()

    const handleGlobalRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason
      if (isInfrastructureSessionError(error)) {
        setInitError(infrastructureErrorMessage(error))
      }
    }

    const handleGlobalError = (event: ErrorEvent) => {
      const error = event.error
      if (isInfrastructureSessionError(error)) {
        setInitError(infrastructureErrorMessage(error))
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("unhandledrejection", handleGlobalRejection)
      window.addEventListener("error", handleGlobalError)
    }

    return () => {
      cancelled = true
      unsubscribe?.()
      if (typeof window !== "undefined") {
        window.removeEventListener("unhandledrejection", handleGlobalRejection)
        window.removeEventListener("error", handleGlobalError)
      }
    }
  }, [connectionAttempt])

  useEffect(() => {
    if (!isLauncherHost() || !window.pywebview?.api) return
    return subscribeAuthSessionReady(() => {
      window.location.reload()
    })
  }, [])

  const withError = async (fn: () => Promise<void>) => {
    setAuthError(null)
    try {
      await fn()
    } catch (e) {
      if (isBenignAuthCancellation(e)) return
      setAuthError(formatAuthError(e))
      throw e
    }
  }

  const withErrorCustom = async (fn: () => Promise<void>) => {
    setAuthError(null)
    try {
      await fn()
    } catch (e) {
      const msg = e instanceof Error && e.message && !e.message.startsWith("Firebase:") ? e.message : formatAuthError(e)
      setAuthError(msg)
      throw e
    }
  }

  /**
   * Google: popup first in normal browsers (redirect fallback when blocked). Apple: popup.
   * `consumeAuthRedirectResultOnce` + `onAuthStateChanged` complete redirect-based sessions.
   */
  const runOAuthSignIn = async (rememberMe: boolean, fn: () => Promise<void>) => {
    if (oauthPopupLockRef.current) {
      setAuthError("A sign-in is already in progress. Please wait a moment and try again.")
      return
    }
    oauthPopupLockRef.current = true
    setAuthError(null)
    const auth = getFirebaseAuth()
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(VT_REMEMBER_ME_FOR_SIGNIN, rememberMe ? "1" : "0")
      }
      await applyAuthPersistenceRememberMe(auth, rememberMe)
      await fn()
    } catch (e) {
      if (isAccountExistsWithDifferentCredential(e)) {
        const m = await messageForAccountExistsWithDifferentCredential(auth, e)
        setAuthError(m)
      } else if (!isBenignAuthCancellation(e)) {
        const msg = formatAuthError(e)
        if (msg) setAuthError(msg)
      }
    } finally {
      oauthPopupLockRef.current = false
    }
  }

  const cancelPendingOAuthSignIn = useCallback(() => {
    oauthPopupLockRef.current = false
    setSessionStatusMessage(null)
    setSessionReady(true)
    setAuthError(null)
  }, [])

  const signInWithGoogle = (rememberMe = true) =>
    runOAuthSignIn(rememberMe, async () => {
      const auth = getFirebaseAuth()
      if (shouldUseGoogleRedirect()) {
        setSessionStatusMessage(GOOGLE_OAUTH_REDIRECT_MESSAGE)
      }
      await signInWithGoogleAccount(auth)
    })

  const signInWithApple = (rememberMe = true) =>
    runOAuthSignIn(rememberMe, async () => {
      const auth = getFirebaseAuth()
      const provider = new OAuthProvider("apple.com")
      await signInWithPopup(auth, provider)
    })

  const signInWithEmailPassword = (email: string, password: string, rememberMe = true) =>
    withErrorCustom(async () => {
      const trimmed = email.trim()
      const pass = password.trim()
      if (!trimmed || !pass) {
        throw new Error("Please enter both email and passcode.")
      }

      const auth = getFirebaseAuth()
      try {
        await applyAuthPersistenceRememberMe(auth, rememberMe)
        const methodsBefore = await fetchSignInMethodsForEmailSafe(auth, trimmed)
        assertCanSignInWithEmailAndPassword(methodsBefore, trimmed)
        pendingSignInCredentialsRef.current = { email: trimmed, password: pass }
        await signInWithEmailAndPassword(auth, trimmed, password)
      } catch (e) {
        pendingSignInCredentialsRef.current = null
        const code = errorCodeOf(e)
        if (isAmbiguousEmailPasswordFailureCode(code)) {
          const methodsAfter = await fetchSignInMethodsForEmailSafe(auth, trimmed)
          if (methodsAfter && methodsAfter.length > 0 && !methodsAfter.includes("password")) {
            throw new Error(instructionWhenNoPasswordOnFile(methodsAfter))
          }
        }
        throw e
      }
    })

  const registerWithEmailPassword = (
    email: string,
    password: string,
    options?: { firstName?: string; lastName?: string; phone?: string; rememberMe?: boolean },
  ) =>
    withErrorCustom(async () => {
      const backendValidation = await validatePasswordWithBackend(password)
      if (!backendValidation.valid) {
        throw new Error(backendValidation.error ?? "Password does not meet security requirements.")
      }

      const auth = getFirebaseAuth()
      const rememberMe = options?.rememberMe !== false
      await applyAuthPersistenceRememberMe(auth, rememberMe)
      const trimmed = email.trim()
      const methods = await fetchSignInMethodsForEmailSafe(auth, trimmed)
      assertCanRegisterWithEmailAndPassword(methods, trimmed)
      const firstName = typeof options?.firstName === "string" ? options.firstName.trim() : ""
      const lastName = typeof options?.lastName === "string" ? options.lastName.trim() : ""
      const phone = typeof options?.phone === "string" ? options.phone.trim() : ""
      const nameValidation = validateNamePart(firstName, "First name") ?? validateNamePart(lastName, "Last name")
      if (nameValidation) throw new Error(nameValidation)
      const phoneValidation = validatePhoneField(phone, { required: true, label: "Phone number" })
      if (phoneValidation) throw new Error(phoneValidation)
      const displayName = [firstName, lastName].filter(Boolean).join(" ")
      registrationSyncSuppressedRef.current = true
      skipNextAuthStateSyncRef.current = true
      try {
        const cred = await createUserWithEmailAndPassword(auth, trimmed, password)
        if (cred.user) {
          if (displayName.length > 0) {
            await updateProfile(cred.user, { displayName })
          }
          if (firstName.length > 0 || lastName.length > 0 || phone.length > 0) {
            await patchProfileSettingsWithBackend(cred.user, {
              firstName,
              lastName,
              phone,
            })
          }
          await deliverVerificationEmailForUser(cred.user, { email: trimmed, password })
        }
        skipNextAuthStateSyncRef.current = true
        await firebaseSignOut(auth)
      } catch (e) {
        if (errorCodeOf(e) === "auth/email-already-in-use") {
          const m = await fetchSignInMethodsForEmailSafe(auth, trimmed)
          if (m && m.length > 0) {
            throw new Error(`This email is already in use. ${describeExistingAccountGuidance(m)}`)
          }
        }
        throw e
      } finally {
        registrationSyncSuppressedRef.current = false
      }
    })

  const sendWorkEmailLink = (email: string, rememberMe = true) =>
    withErrorCustom(async () => {
      if (typeof window === "undefined") return
      const auth = getFirebaseAuth()
      const trimmed = email.trim()
      const methods = await fetchSignInMethodsForEmailSafe(auth, trimmed)
      assertCanSendEmailSignInLink(methods, trimmed)
      const actionCodeSettings = {
        url: getFirebaseAuthContinueUrl(),
        handleCodeInApp: true,
      }
      window.localStorage.setItem(VT_EMAIL_FOR_SIGNIN, trimmed)
      window.localStorage.setItem(VT_REMEMBER_ME_FOR_SIGNIN, rememberMe ? "1" : "0")
      await sendSignInLinkToEmail(auth, trimmed, actionCodeSettings)
    })

  const sendPasswordReset = (email: string) => sendFirebasePasswordResetEmail(email)

  const logout = () =>
    withError(async () => {
      setAppInitialized(false)
      setAppInitPercent(0)
      setDashboardSummary(null)
      setSessionAuthorized(false)
      clearVerificationGate()
      void clearSharedSessionCookie()
      const { clearAllListCaches } = await import("@/shared/tables/hooks/list-cache-registry")
      clearAllListCaches()
      const { postActivitySession } = await import("@/features/activity/services/activity-api")
      await postActivitySession("stop").catch(() => { })
      const { disconnectPresenceWebSocket } = await import("@/features/auth/services/presence-ws")
      const { closePresenceEventStream } = await import("@/features/auth/services/presence-events-sse")
      disconnectPresenceWebSocket()
      closePresenceEventStream()
      const auth = getFirebaseAuth()
      await firebaseSignOut(auth)
    })

  const clearVerificationGate = useCallback(() => {
    setVerificationGate(null)
    setVerificationGateMessage(null)
    setVerificationGateError(null)
    pendingSignInCredentialsRef.current = null
  }, [])

  const resendVerificationEmail = useCallback(async () => {
    if (!verificationGate) return
    setVerificationGateError(null)
    setVerificationGateMessage(null)
    const auth = getFirebaseAuth()
    try {
      skipNextAuthStateSyncRef.current = true
      await signInWithEmailAndPassword(auth, verificationGate.email, verificationGate.password)
      const current = auth.currentUser
      if (!current) throw new Error("Could not send verification email.")
      await deliverVerificationEmailForUser(current, verificationGate)
      skipNextAuthStateSyncRef.current = true
      await firebaseSignOut(auth)
    } catch (err) {
      setVerificationGateError(formatVerificationEmailError(err))
      skipNextAuthStateSyncRef.current = true
      await firebaseSignOut(auth).catch(() => {})
    }
  }, [verificationGate, deliverVerificationEmailForUser])

  const refreshProfile = useCallback(async () => {
    const auth = getFirebaseAuth()
    const u = auth.currentUser
    if (!u) return
    await reload(u)
    const { profile: nextProfile, memberId } = await syncBackend(u)
    setProfile(nextProfile ?? null)
    const member = await fetchCurrentMemberWithFallback(memberId)
    setCurrentMember(member)
    setSessionAuthorized(true)
    const { invalidatePeopleMemberCaches } = await import("@/shared/tables/hooks/list-cache-registry")
    invalidatePeopleMemberCaches(member?.id)
    setUser(auth.currentUser)
  }, [])

  const memberRole = getMemberRoleLabel(currentMember)
  const memberId = currentMember?.id

  const value: AuthContextType = {
    user,
    profile,
    isLoggedIn: sessionAuthorized,
    loading,
    sessionReady,
    sessionStatusMessage,
    sessionConnectionError,
    retrySessionSync,
    backendReconnecting,
    currentMember,
    memberRole,
    memberId,
    dashboardSummary,
    initError,
    retryConnection,
    authError,
    appInitialized,
    appInitProgress,
    appInitPercent,
    appInitError,
    retryInit,
    clearAuthError,
    resetAuthGateMessages,
    cancelPendingOAuthSignIn,
    signInWithGoogle,
    signInWithApple,
    signInWithEmailPassword,
    registerWithEmailPassword,
    sendWorkEmailLink,
    sendPasswordReset,
    logout,
    refreshProfile,
    verificationGate,
    clearVerificationGate,
    resendVerificationEmail,
    verificationGateMessage,
    verificationGateError,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthErrorToastHost message={authError} onDismiss={clearAuthError} />
    </AuthContext.Provider>
  )
}

/** Block email-link completion when account uses another sign-in method. */
function assertCanUseEmailLinkCompletion(methods: string[] | null, email: string): void {
  if (methods === null || methods.length === 0) return
  if (methods.includes("emailLink")) return
  if (methods.includes("password")) {
    throw new Error(
      `This email is registered with a password. Sign in with your email and password on the main form, not via the link, for ${email}.`
    )
  }
  if (methods.includes("google.com")) {
    throw new Error(
      `This email is registered with Google. Sign in with the Google button on this page, not the email link, for ${email}.`
    )
  }
  if (methods.includes("apple.com")) {
    throw new Error(
      `This email is registered with Apple. Sign in with the Apple button on this page, not the email link, for ${email}.`
    )
  }
}
