"use client"

import { useState } from "react"
import { ShieldAlert } from "lucide-react"
import { requestScreenshotRemoval } from "@/features/activity/services/activity-api"

const MAX_REASON = 1000

/**
 * "Ask for this to be removed", shown in the screenshot viewer to people who
 * can see their own captures but not delete them - clients, employees,
 * interns, team leads.
 *
 * Only ever offered on the viewer's OWN screenshot: objecting to someone
 * else's is not a privacy objection, and the backend refuses it regardless.
 */
export function ScreenshotRemovalRequest({ screenshotId }: { screenshotId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        Request sent. Someone who can remove it will review it.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/50"
      >
        <ShieldAlert className="h-4 w-4" />
        Request removal
      </button>
    )
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <label
        htmlFor="removal-reason"
        className="mb-1.5 block text-xs font-semibold text-amber-800 dark:text-amber-300"
      >
        Why should this be removed?
      </label>
      <textarea
        id="removal-reason"
        rows={3}
        maxLength={MAX_REASON}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="It captured something private."
        className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none dark:border-amber-900/60 dark:bg-slate-900 dark:text-slate-200"
      />
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError("")
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true)
            setError("")
            try {
              await requestScreenshotRemoval(screenshotId, reason.trim())
              setSent(true)
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not send that request.")
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-amber-700"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
    </div>
  )
}
