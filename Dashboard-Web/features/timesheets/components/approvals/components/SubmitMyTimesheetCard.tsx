"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/shared/utils/utils"
import {
  fetchTimesheetPeriodSummary,
  submitTimesheetPeriod,
  type TimesheetPeriodSummary,
} from "@/features/timesheets/api/timesheet-api"
import { changedEvent } from "@/infrastructure/api/change-events"

/** Monday-start week containing `ref`, as YYYY-MM-DD in local time. */
function currentWeekPeriod(ref = new Date()): { start: string; end: string } {
  const day = ref.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = new Date(ref)
  start.setDate(ref.getDate() + mondayOffset)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { start: iso(start), end: iso(end) }
}

function formatHours(hours: number): string {
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  return `${whole}:${String(minutes).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected — you can resubmit",
}

/**
 * Lets a member submit their own pay period. Hours shown here are computed
 * server-side from time actually tracked (manual entries + tracked sessions);
 * nothing about them is sent from the browser.
 */
export function SubmitMyTimesheetCard() {
  const [period] = useState(() => currentWeekPeriod())
  const [summary, setSummary] = useState<TimesheetPeriodSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchTimesheetPeriodSummary(period.start, period.end)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [period.start, period.end])

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [load])

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await submitTimesheetPeriod(period.start, period.end)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit timesheet.")
    } finally {
      setSubmitting(false)
    }
  }

  const status = summary?.timesheet?.status ?? null
  const alreadyLocked = status === "submitted" || status === "approved"
  const noTime = (summary?.totalHours ?? 0) <= 0

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-800">Your timesheet</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {period.start} – {period.end}
          </p>
        </div>
        {status ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              status === "approved"
                ? "bg-emerald-50 text-emerald-600"
                : status === "submitted"
                  ? "bg-blue-50 text-blue-600"
                  : status === "rejected"
                    ? "bg-red-50 text-red-600"
                    : "bg-slate-100 text-slate-600"
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">Loading your tracked time…</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total</div>
              <div className="text-lg font-semibold tabular-nums text-slate-800">
                {formatHours(summary?.totalHours ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Billable</div>
              <div className="text-lg font-semibold tabular-nums text-slate-800">
                {formatHours(summary?.billableHours ?? 0)}
              </div>
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || alreadyLocked || noTime}
            className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Submitting…"
              : status === "rejected"
                ? "Resubmit timesheet"
                : "Submit timesheet"}
          </button>
          {noTime && !alreadyLocked ? (
            <p className="mt-2 text-xs text-slate-400">No tracked time in this period yet.</p>
          ) : null}
        </>
      )}
    </div>
  )
}
