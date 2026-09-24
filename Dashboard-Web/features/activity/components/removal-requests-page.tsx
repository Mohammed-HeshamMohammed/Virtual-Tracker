"use client"

import { useCallback, useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { canManageActivityData } from "@/features/auth"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  listScreenshotRemovalRequests,
  resolveScreenshotRemovalRequest,
  type PendingRemovalRequest,
} from "@/features/activity/services/activity-api"

type Tab = "pending" | "resolved"

/**
 * Removal requests as a page of their own, rather than only a banner above
 * the screenshot grid.
 *
 * It carries the decided ones too: approving deletes someone's screenshot and
 * declining refuses to, and both should be answerable afterwards by whoever
 * asks why.
 */
export function RemovalRequestsPage() {
  const { isDark } = useTheme()
  const { memberRole } = useAuth()
  const t = isDark ? dark : light
  const canReview = canManageActivityData(memberRole)

  const [tab, setTab] = useState<Tab>("pending")
  const [requests, setRequests] = useState<PendingRemovalRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await listScreenshotRemovalRequests(tab)
      setRequests(result.requests)
      setPendingCount(result.pendingCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load removal requests")
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    if (canReview) void load()
    else setLoading(false)
  }, [load, canReview])

  async function resolve(request: PendingRemovalRequest, approve: boolean) {
    setBusyId(request.id)
    setError("")
    try {
      await resolveScreenshotRemovalRequest(request.id, approve)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve that request.")
    } finally {
      setBusyId(null)
    }
  }

  if (!canReview) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Only people who can remove screenshots can review these requests.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-2">
      <div className={cn("shrink-0 rounded-xl border p-5", t.tableBorder, t.tableBg)}>
        <div className="flex items-center gap-2">
          <ShieldAlert className={cn("h-5 w-5", isDark ? "text-amber-400" : "text-amber-600")} />
          <h2 className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Removal requests
          </h2>
          {pendingCount > 0 ? (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              {pendingCount}
            </span>
          ) : null}
        </div>
        <p className={cn("mt-0.5 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
          People who cannot delete their own screenshots can ask for one to be removed. Approving
          deletes it; declining keeps it. Both are recorded.
        </p>

        <div className="mt-4 flex gap-1">
          {(["pending", "resolved"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "border-b-2 px-3 py-2 text-xs font-semibold capitalize transition-colors",
                tab === key
                  ? isDark
                    ? "border-amber-400 text-[#dce1fb]"
                    : "border-amber-600 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
              )}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        {error ? <p className="mb-2 text-sm text-red-500">{error}</p> : null}
        {loading ? (
          <p className="p-10 text-center text-sm text-slate-400">Loading…</p>
        ) : !requests.length ? (
          <p className="p-10 text-center text-sm text-slate-400">
            {tab === "pending" ? "Nothing waiting." : "Nothing has been decided yet."}
          </p>
        ) : (
          <ul className={cn("divide-y rounded-xl border", t.tableBorder, t.tableBg)}>
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                    {request.memberName}
                    {request.capturedAt ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        captured {new Date(request.capturedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </p>
                  {request.reason ? (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{request.reason}</p>
                  ) : (
                    <p className="mt-1 text-sm italic text-slate-400">No reason given</p>
                  )}
                  {request.status !== "pending" ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {request.status === "approved" ? "Approved" : "Declined"}
                      {request.reviewedBy ? ` by ${request.reviewedBy}` : ""}
                      {request.reviewedAt ? ` on ${new Date(request.reviewedAt).toLocaleString()}` : ""}
                      {request.reviewNote ? ` — ${request.reviewNote}` : ""}
                    </p>
                  ) : null}
                </div>
                {request.status === "pending" ? (
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
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
