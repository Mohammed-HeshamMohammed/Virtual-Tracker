"use client"

import { useEffect, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchWeeklyLimitsReport, fetchDailyLimitsReport } from "@/features/reports/api/misc-reports-api"
import type { LimitUsageRow } from "@/features/reports/models/limits"
import { cn } from "@/shared/utils/utils"

function LimitsTable({ kind }: { kind: "weekly" | "daily" }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, registerExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<LimitUsageRow[]>([])

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    const fetcher = kind === "weekly" ? fetchWeeklyLimitsReport : fetchDailyLimitsReport
    fetcher({ from, to }).then((data) => {
      if (!cancelled) setRows(data)
    })
    return () => {
      cancelled = true
    }
  }, [kind, rangeStart, rangeEnd])

  useEffect(() => {
    const runExport = () => {
      const header = ["Member", "Tracked hours", "Limit (hrs)", "% used"]
      const lines = rows.map((r) =>
        [r.name, r.trackedHours.toFixed(2), r.limitHours.toFixed(2), `${r.pctUsed}%`]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-limits-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [rows, kind, registerExportHandler])

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Member</th>
            <th className={th}>Tracked</th>
            <th className={cn(th, "min-w-48")}>{kind === "weekly" ? "Weekly limit" : "Daily limit"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No members with a {kind} limit set.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr
              key={row.memberId}
              className={cn("border-b last:border-b-0", isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80")}
            >
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                    {row.initials}
                  </span>
                  <span className={cn("font-medium", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{row.name}</span>
                </div>
              </td>
              <td className={cn("px-4 py-3.5 tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                {row.trackedHours.toFixed(1)}h
              </td>
              <td className="px-4 py-3.5">
                {row.limitHours > 0 ? (
                  <div className="space-y-2">
                    <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{row.limitHours.toFixed(1)}h</div>
                    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-white/10" : "bg-slate-200")}>
                      <div
                        className={cn("h-full rounded-full transition-[width]", row.pctUsed >= 100 ? "bg-red-500" : "bg-blue-500")}
                        style={{ width: `${Math.min(100, row.pctUsed)}%` }}
                      />
                    </div>
                    <div className={cn("text-xs tabular-nums", isDark ? "text-white/45" : "text-slate-500")}>{row.pctUsed}%</div>
                  </div>
                ) : (
                  <span className={cn("text-sm", isDark ? "text-white/40" : "text-slate-400")}>No limit set</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WeeklyLimitsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <StandardReportLayout title="Weekly limits report" onNavigate={onNavigate} exportFileBaseName="weekly-limits" showScopeTabs={false} showGroupBy={false}>
      <LimitsTable kind="weekly" />
    </StandardReportLayout>
  )
}

export function DailyLimitsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <StandardReportLayout title="Daily limits report" onNavigate={onNavigate} exportFileBaseName="daily-limits" showScopeTabs={false} showGroupBy={false}>
      <LimitsTable kind="daily" />
    </StandardReportLayout>
  )
}
