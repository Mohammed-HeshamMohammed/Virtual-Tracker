"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/shared/utils/utils"
import {
  fetchTimesheetPeriodSummary,
  submitTimesheetPeriod,
  type TimesheetPeriodSummary,
} from "@/features/timesheets/api/timesheet-api"
import { formatMoney } from "@/features/reports/utils/money"
import { changedEvent } from "@/infrastructure/api/change-events"

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

export function SubmitMyTimesheetCard() {
  const [summary, setSummary] = useState<TimesheetPeriodSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchTimesheetPeriodSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [load])

  async function submit() {
    if (!summary) return
    setSubmitting(true)
    setError(null)
    try {
      await submitTimesheetPeriod(summary.periodStart, summary.periodEnd)
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
  const projects = summary?.projects ?? []

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Your timesheet</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {summary ? `${summary.periodStart} – ${summary.periodEnd}` : "Loading period…"}
          </p>
        </div>
        {status ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              status === "approved"
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                : status === "submitted"
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
                  : status === "rejected"
                    ? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">Loading your tracked time…</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total</div>
              <div className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {formatHours(summary?.totalHours ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Billable</div>
              <div className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {formatHours(summary?.billableHours ?? 0)}
              </div>
            </div>
            {(summary?.amount ?? 0) > 0 ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Amount</div>
                <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatMoney(summary?.amount ?? 0, summary?.currency ?? "USD")}
                </div>
              </div>
            ) : null}
          </div>

          {projects.length > 0 ? (
            <div className="mt-4 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">By project</p>
              {projects.map((p) => (
                <div key={p.projectId ?? "none"} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{p.projectName}</span>
                  <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                    {formatHours(p.hours)}
                    {p.amount > 0 ? ` · ${formatMoney(p.amount, summary?.currency ?? "USD")}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || alreadyLocked || noTime}
            className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {submitting
              ? "Submitting…"
              : status === "rejected"
                ? "Resubmit timesheet"
                : "Submit timesheet"}
          </button>
          {noTime && !alreadyLocked ? (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">No tracked time in this period yet.</p>
          ) : null}
        </>
      )}
    </div>
  )
}
