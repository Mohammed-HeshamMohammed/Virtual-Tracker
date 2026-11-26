"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { refreshMemberPage } from "@/features/messages/api/messages-api"

/**
 * The Owner or a Super Admin reloading one person's dashboard, so it picks up the latest
 * release. Their page counts down first and says who asked. Live only: it says plainly when
 * they have no dashboard open instead of pretending it went through.
 */
export function RefreshPageModal({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string
  memberName: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [pages, setPages] = useState<number | null>(null)

  async function send() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const result = await refreshMemberPage(memberId)
      setPages(result.pages)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh their page.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Refresh ${memberName}'s page`}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Refresh {memberName === "yourself" ? "your" : `${memberName}'s`} page
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Every dashboard tab they have open reloads, so they get the latest version. They see a
              10-second countdown that says you asked, and anything they have not saved is lost.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {pages != null ? (
          <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            <p>
              Sent. {pages === 1 ? "Their open page refreshes" : `Their ${pages} open pages refresh`} in a few
              seconds.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white dark:bg-emerald-600"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {busy ? "Refreshing…" : "Refresh their page"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
