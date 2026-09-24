"use client"

import { useCallback, useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import {
  listScreenshotRemovalRequests,
  resolveScreenshotRemovalRequest,
  type PendingRemovalRequest,
} from "@/features/activity/services/activity-api"

/**
 * The other half of ScreenshotRemovalRequest: what someone who *can* delete
 * sees. Shown only when there is something to act on, so it stays out of the
 * way the rest of the time.
 *
 * Approving deletes the screenshot. Declining keeps it and records why, so
 * the decision is answerable later either way.
 */
export function ScreenshotRemovalQueue({ onResolved }: { onResolved?: () => void }) {
  const [requests, setRequests] = useState<PendingRemovalRequest[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      setRequests(await listScreenshotRemovalRequests())
    } catch {
      // A failure here must not break the screenshots page itself.
      setRequests([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(request: PendingRemovalRequest, approve: boolean) {
    setBusyId(request.id)
    setError("")
    try {
      await resolveScreenshotRemovalRequest(request.id, approve)
      setRequests((prev) => prev.filter((r) => r.id !== request.id))
      onResolved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve that request.")
    } finally {
      setBusyId(null)
    }
  }

  if (!requests.length) return null

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {requests.length} screenshot removal {requests.length === 1 ? "request" : "requests"}
        </h3>
      </div>
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
      <ul className="mt-3 space-y-2">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white/80 p-3 dark:bg-slate-900/60"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {request.memberName}
                {request.capturedAt ? (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    captured {new Date(request.capturedAt).toLocaleString()}
                  </span>
                ) : null}
              </p>
              {request.reason ? (
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{request.reason}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busyId === request.id}
                onClick={() => void resolve(request, true)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                Approve &amp; delete
              </button>
              <button
                type="button"
                disabled={busyId === request.id}
                onClick={() => void resolve(request, false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
