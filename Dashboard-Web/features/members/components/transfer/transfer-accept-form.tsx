"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  acceptMemberTransferRequest,
  declineMemberTransferRequest,
  getTransferRequestPreview,
} from "@/features/members/services/member-transfer-requests"
import { useAuth } from "@/shared/providers/app"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { useTheme } from "@/shared/providers/app"

export function TransferAcceptForm({ token }: { token: string }) {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const { isDark } = useTheme()
  const styles = getAuthStyles(isDark)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [requesterName, setRequesterName] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const preview = await getTransferRequestPreview(token)
        if (!cancelled) setRequesterName(preview.requester_name)
      } catch (e) {
        if (!cancelled) setPageError(e instanceof Error ? e.message : "Invalid or expired invitation.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onAccept() {
    setBusy(true)
    try {
      await acceptMemberTransferRequest(token)
      setDone(true)
      router.replace("/")
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Could not accept invitation.")
    } finally {
      setBusy(false)
    }
  }

  async function onDecline() {
    setBusy(true)
    try {
      await declineMemberTransferRequest(token)
      router.replace("/")
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Could not decline invitation.")
    } finally {
      setBusy(false)
    }
  }

  if (!isLoggedIn) {
    return (
      <div className={styles.card}>
        <h1 className={styles.heading}>Sign in required</h1>
        <p className={styles.body}>Sign in with the invited account to review this team invitation.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
        Loading invitation…
      </div>
    )
  }

  if (pageError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900 shadow-sm">
        {pageError}
      </div>
    )
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center text-sm text-emerald-900 shadow-sm">
        You have joined the team. Redirecting…
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.heading}>Team invitation</h1>
      <p className={styles.body}>
        <strong>{requesterName}</strong> has invited you to join their team on Virtual Tracker.
      </p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Your role will remain unchanged unless specified in the invitation.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {busy ? "Processing…" : "Accept invitation"}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium dark:border-slate-700"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
