"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/shared/providers/app"
import { getTimesheets, approveTimesheet, rejectTimesheet, type Timesheet } from "@/infrastructure/api"
import { changedEvent } from "@/infrastructure/api/change-events"

function formatPeriodLabel(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00.000Z`)
  const e = new Date(`${end}T00:00:00.000Z`)
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`
}

/**
 * Management's review queue for submitted timesheet *periods* - distinct
 * from PendingManualTimeQueue, which reviews individual manual time
 * entries. Extracted out of the old combined Approvals page's "Timesheets"
 * tab unchanged; it now backs the standalone Timesheets page instead.
 */
export function PendingApprovalsQueue({
  members,
}: {
  members: { id: string; name: string }[]
}) {
  const { memberId } = useAuth()
  const [pending, setPending] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    getTimesheets({ status: "submitted" })
      .then((rows) => setPending(rows))
      .catch(() => setPending([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [])

  const nameById = new Map(members.map((m) => [m.id, m.name]))

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id)
    setError(null)
    try {
      const approverId = memberId ?? ""
      if (action === "approve") await approveTimesheet(id, approverId)
      else await rejectTimesheet(id, approverId)
      setPending((rows) => rows.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update timesheet.")
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <p className="text-center text-sm text-slate-400">Loading pending timesheets…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Pending approvals {pending.length > 0 ? `(${pending.length})` : ""}
      </h2>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          No timesheets waiting for approval.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {pending.map((ts) => (
            <div key={ts.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {nameById.get(ts.memberId) ?? "Unknown member"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatPeriodLabel(ts.periodStart, ts.periodEnd)} · {ts.totalHours.toFixed(2)}h total
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === ts.id}
                  onClick={() => act(ts.id, "reject")}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === ts.id}
                  onClick={() => act(ts.id, "approve")}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busyId === ts.id ? "…" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
