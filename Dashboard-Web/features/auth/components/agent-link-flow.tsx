"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/shared/providers/app"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"
import { completeAgentLink } from "@/features/auth/api/agent-link-api"
import { DASHBOARD_PATH, finishAgentLinkSuccess } from "@/features/auth/services/navigation"
import { getDashboardApiBaseUrl } from "@/infrastructure/api/url"
import {
  waitForLocalAgentAuthenticated,
  fetchLocalAgentHealth,
  ensureLoopbackAgentAccess,
  resumeLocalAgentLinkPoll,
  deliverLocalAgentCredentials,
  type LocalAgentHealth,
} from "@/features/activity/utils/local-agent"
import { Monitor, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"

type LinkState = "confirm" | "linking" | "success" | "error" | "invalid"

const INVALID_LINK_MESSAGE =
  "This linking session is invalid or expired. Open Virtual Tracker Agent and click Sign In again."

function assertAgentApiHostMatches(health: LocalAgentHealth): void {
  const expectedHost = new URL(getDashboardApiBaseUrl()).host
  if (!health.apiUrl) return
  let agentHost = ""
  try {
    agentHost = new URL(health.apiUrl).host
  } catch {
    return
  }
  if (agentHost && agentHost !== expectedHost) {
    throw new Error(
      `Desktop agent API (${agentHost}) does not match dashboard API (${expectedHost}). Rebuild Virtual Tracker Agent with VT_API_URL=${getDashboardApiBaseUrl()}, then click Sign In again.`,
    )
  }
}

async function assertAgentReadyForLink(linkToken: string): Promise<void> {
  const health = await fetchLocalAgentHealth()
  if (!health?.ok) {
    throw new Error(
      "Virtual Tracker Agent is not running on this PC. Open the agent, click Sign In, then return here.",
    )
  }
  assertAgentApiHostMatches(health)
  if (health.authenticated) {
    return
  }
  if (!health.linkPending) {
    throw new Error(
      "The desktop agent is not waiting for this link. In the agent, click Sign In first, then return here and click Link this account.",
    )
  }
  if (health.linkToken && health.linkToken !== linkToken) {
    throw new Error(
      "This browser tab has an outdated link. In the agent, click Open Link Page, then Link this account again.",
    )
  }
}

export function AgentLinkFlow({ linkToken }: { linkToken: string }) {
  const router = useRouter()
  const { user, logout } = useAuth()
  const trimmedToken = linkToken.trim()
  const isInvalidToken = trimmedToken.length === 0
  const [state, setState] = useState<LinkState>("confirm")
  const [message, setMessage] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const attemptRef = useRef(0)

  const displayState: LinkState = isInvalidToken ? "invalid" : state
  const displayMessage = isInvalidToken ? INVALID_LINK_MESSAGE : message

  useEffect(() => {
    if (isInvalidToken) return
    if (!user) return
    if (!confirmed) {
      setState("confirm")
      return
    }

    const attemptId = ++attemptRef.current
    let cancelled = false

    async function linkAgent() {
      setState("linking")
      try {
        await assertAgentReadyForLink(trimmedToken)
        const alreadyLinked = await fetchLocalAgentHealth()
        if (cancelled || attemptId !== attemptRef.current) return
        if (alreadyLinked?.authenticated) {
          await finishAgentLinkSuccess()
          if (cancelled || attemptId !== attemptRef.current) return
          setState("success")
          return
        }

        const auth = getFirebaseAuth()
        const currentUser = auth.currentUser
        if (!currentUser) throw new Error("Sign in expired. Refresh this page and try again.")
        const refreshToken =
          "refreshToken" in currentUser && typeof currentUser.refreshToken === "string"
            ? currentUser.refreshToken
            : ""
        const result = await completeAgentLink(trimmedToken, refreshToken)
        if (cancelled || attemptId !== attemptRef.current) return
        if (!result.ok) throw new Error(result.error || "Failed to link agent")

        // Primary path: agent polls backend link/exchange after complete (Chrome 150+ safe).
        await ensureLoopbackAgentAccess()
        await resumeLocalAgentLinkPoll()

        // Fallback: deliver tokens to localhost if the agent is still waiting.
        try {
          const idToken = await currentUser.getIdToken(true)
          await deliverLocalAgentCredentials(trimmedToken, idToken, refreshToken)
        } catch {
          /* ignore — exchange poll may still succeed */
        }

        const agentReady = await waitForLocalAgentAuthenticated(undefined, 45_000)
        if (cancelled || attemptId !== attemptRef.current) return
        if (!agentReady) {
          const health = await fetchLocalAgentHealth()
          if (!health?.authenticated) {
            if (!health?.ok) {
              throw new Error(
                "Link was approved, but Virtual Tracker Agent is not reachable on this PC. Keep the agent open, then Try again.",
              )
            }
            if (!health.linkPending) {
              throw new Error(
                "The desktop agent stopped waiting for credentials. In the agent, click Sign In first, then Link this account here again.",
              )
            }
            throw new Error(
              "The desktop agent did not finish linking yet. Keep it open, click Sign In once if needed, then Try again.",
            )
          }
        }

        await finishAgentLinkSuccess()
        if (cancelled || attemptId !== attemptRef.current) return
        setState("success")
      } catch (e) {
        if (cancelled || attemptId !== attemptRef.current) return
        setState("error")
        setMessage(e instanceof Error ? e.message : "Failed to link agent")
      }
    }

    void linkAgent()
    return () => {
      cancelled = true
    }
  }, [confirmed, isInvalidToken, trimmedToken, router, user])

  const accountLabel = user?.email || user?.displayName || "this account"

  async function handleUseDifferentAccount() {
    setConfirmed(false)
    setState("confirm")
    await logout()
  }

  function handleConfirmLink() {
    setConfirmed(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
          <Monitor className="h-7 w-7 text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Link Virtual Tracker Agent</h1>
        <p className="mt-2 text-sm text-slate-400">
          After signing in, confirm linking below. The desktop agent will connect automatically once you approve.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          {displayState === "confirm" && (
            <>
              <p className="text-sm text-slate-300">
                Link the desktop agent to <span className="font-medium text-white">{accountLabel}</span>?
              </p>
              <button
                type="button"
                onClick={handleConfirmLink}
                className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Link this account
              </button>
              <button
                type="button"
                onClick={() => void handleUseDifferentAccount()}
                className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Use a different account
              </button>
            </>
          )}

          {displayState === "linking" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              <p className="text-sm text-slate-400">Completing secure link…</p>
              <p className="text-xs text-slate-500">Keep the desktop agent open on this PC.</p>
            </>
          )}

          {displayState === "success" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              <p className="text-sm text-slate-300 font-medium">Agent linked successfully</p>
              <p className="text-sm text-slate-400">
                You can close this tab and return to Virtual Tracker Agent.
              </p>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.close()
                  } catch {
                    /* ignore */
                  }
                }}
                className="mt-2 w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Close this tab
              </button>
              <button
                type="button"
                onClick={() => router.replace(DASHBOARD_PATH)}
                className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Go to dashboard instead
              </button>
            </>
          )}

          {displayState === "invalid" && (
            <>
              <AlertCircle className="h-8 w-8 text-amber-400" />
              <p className="text-sm text-slate-300">{displayMessage}</p>
            </>
          )}

          {displayState === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-300">{displayMessage}</p>
              <button
                type="button"
                onClick={() => {
                  setConfirmed(false)
                  setState("confirm")
                  setMessage("")
                }}
                className="mt-2 w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Try again
              </button>
              <p className="text-xs text-slate-500 mt-2">
                If the link expired, click <span className="text-slate-400">Re-link Account</span> in the desktop
                agent, then confirm here again.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
