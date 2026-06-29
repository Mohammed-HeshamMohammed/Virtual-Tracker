"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/shared/providers/app"
import {
  AgentLinkFlow,
  AuthPage1,
  AuthSessionLoader,
  CompleteRegistrationGate,
  useBodyScrollLock,
} from "@/features/auth/components"
import { LauncherGoogleOAuthBanner } from "@/features/auth/components/launcher-google-oauth-banner"
import { GOOGLE_OAUTH_REDIRECT_MESSAGE } from "@/features/auth"
import { AuthGateShell } from "@/features/auth/components/auth-gate-shell"
import { DashboardShell } from "@/app/dashboard-shell"
import { InviteAcceptForm } from "@/features/members"
import { TransferAcceptForm } from "@/features/members"
import { DASHBOARD_PATH } from "@/features/auth"
import { PasswordPolicyProvider } from "@/features/auth"

/** Drop legacy auth query params so the address bar stays at `/`. */
function useStripLegacyAuthParams() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (!params.has("returnTo")) return
    params.delete("returnTo")
    const query = params.toString()
    router.replace(query ? `${DASHBOARD_PATH}?${query}` : DASHBOARD_PATH)
  }, [router, searchParams])
}

function HomeClientInner() {
  useStripLegacyAuthParams()

  const searchParams = useSearchParams()
  const inviteToken = searchParams.get("inviteToken")?.trim() ?? ""
  const transferToken = searchParams.get("transferToken")?.trim() ?? ""
  const linkToken = searchParams.get("link")?.trim() ?? ""
  const { user, isLoggedIn, sessionReady, sessionStatusMessage, sessionConnectionError, retryConnection, profile, initError, loading, cancelPendingOAuthSignIn } = useAuth()

  const mustChangePassword = Boolean(isLoggedIn && profile?.mustChangePassword)
  useBodyScrollLock(mustChangePassword)

  const googleRedirectPending = sessionStatusMessage === GOOGLE_OAUTH_REDIRECT_MESSAGE

  const awaitingSession =
    Boolean(initError) ||
    Boolean(sessionConnectionError) ||
    loading ||
    (!sessionReady && !googleRedirectPending) ||
    Boolean(user && !isLoggedIn)

  if (!isLoggedIn && awaitingSession) {
    return (
      <AuthSessionLoader
        message={sessionStatusMessage ?? "Checking your session..."}
        error={sessionConnectionError ?? initError}
        onRetry={() => retryConnection()}
        onCancel={googleRedirectPending ? cancelPendingOAuthSignIn : undefined}
      />
    )
  }

  if (inviteToken && !isLoggedIn) {
    return (
      <AuthGateShell>
        <InviteAcceptForm token={inviteToken} />
      </AuthGateShell>
    )
  }

  if (!isLoggedIn) {
    if (linkToken) {
      return (
        <AuthGateShell>
          <LauncherGoogleOAuthBanner message={sessionStatusMessage} onCancel={cancelPendingOAuthSignIn} />
          <div className="mx-auto mb-6 max-w-md rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-100">
            Sign in below, then click <span className="font-semibold text-white">Link this account</span> to finish
            connecting Virtual Tracker Agent.
          </div>
          <AuthPage1 />
        </AuthGateShell>
      )
    }
    return (
      <>
        <LauncherGoogleOAuthBanner message={sessionStatusMessage} onCancel={cancelPendingOAuthSignIn} />
        <AuthPage1 />
      </>
    )
  }

  if (transferToken && isLoggedIn) {
    return (
      <div
        className="fixed inset-0 z-500 flex min-h-dvh w-full max-w-full m-0 border-none items-center justify-center overflow-y-auto bg-slate-100 p-6"
        aria-label="Team membership invitation"
      >
        <div className="w-full max-w-md">
          <TransferAcceptForm token={transferToken} />
        </div>
      </div>
    )
  }

  if (linkToken) {
    return <AgentLinkFlow linkToken={linkToken} />
  }

  if (mustChangePassword) {
    return (
      <AuthGateShell>
        <CompleteRegistrationGate />
      </AuthGateShell>
    )
  }

  return <DashboardShell />
}

export function HomeClient() {
  return (
    <PasswordPolicyProvider>
      <HomeClientInner />
    </PasswordPolicyProvider>
  )
}
