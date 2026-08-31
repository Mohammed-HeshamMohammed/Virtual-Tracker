"use client"

import { useEffect, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchWeeklyLimitsReport, fetchDailyLimitsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { LimitUsageRow } from "@/features/reports/models/limits"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, STANDARD_REPORT_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"

function LimitsTable({ kind, filters }: { kind: "weekly" | "daily"; filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<LimitUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  // A failed read used to be indistinguishable from an empty report:
  // getJson swallowed every error and the table rendered "no rows".
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    setLoading(true)
    setError(null)
    const fetcher = kind === "weekly" ? fetchWeeklyLimitsReport : fetchDailyLimitsReport
    fetcher({ from, to, memberIds: [...filters.memberIds] })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, rangeStart, rangeEnd, filters, reloadKey])

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

  useEffect(() => {
    const runPdfExport = () => {
      const limitLabel = kind === "weekly" ? "Weekly limit" : "Daily limit"
      const withLimit = rows.filter((r) => r.limitHours > 0)
      downloadReportPdf({
        title: kind === "weekly" ? "Weekly Limits Report" : "Daily Limits Report",
        subtitle: `Tracked hours against each member's ${kind} limit.`,
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        charts:
          withLimit.length > 0
            ? [
                {
                  type: "progress",
                  title: `${limitLabel} usage`,
                  rows: withLimit
                    .slice()
                    .sort((a, b) => b.pctUsed - a.pctUsed)
                    .map((r) => ({
                      label: r.name,
                      pct: r.pctUsed,
                      sublabel: `${r.trackedHours.toFixed(1)}h of ${r.limitHours.toFixed(1)}h`,
                    })),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Member", key: "member" },
            { header: "Tracked", key: "tracked", align: "right" },
            { header: limitLabel, key: "limit", align: "right" },
            { header: "% used", key: "pct", align: "right" },
          ],
          rows: rows.map((r) => ({
            member: r.name,
            tracked: `${r.trackedHours.toFixed(1)}h`,
            limit: r.limitHours > 0 ? `${r.limitHours.toFixed(1)}h` : "No limit set",
            pct: r.limitHours > 0 ? `${r.pctUsed}%` : "—",
          })),
          emptyMessage: `No members with a ${kind} limit set.`,
        },
        filename: `${kind}-limits`,
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, kind, dateLabel, registerPdfExportHandler])

  if (loading) return <ReportTableSkeleton rows={6} columns={3} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

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

/** Limits are per member and carry no project dimension, so the panel offers
 *  members only. */
function LimitsReport({
  kind,
  title,
  exportFileBaseName,
  pageId,
  onNavigate,
}: {
  kind: "weekly" | "daily"
  title: string
  exportFileBaseName: string
  pageId: string
  onNavigate: (id: string) => void
}) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title={title}
      onNavigate={onNavigate}
      exportFileBaseName={exportFileBaseName}
      pageId={pageId}
      showScopeTabs={false}
      showGroupBy={false}
      filtersPanel={(close) => (
        <ReportFiltersPanel
          onClose={close}
          options={options}
          value={filters}
          onChange={setFilters}
          showProjects={false}
        />
      )}
    >
      <LimitsTable kind={kind} filters={filters} />
    </StandardReportLayout>
  )
}

export function WeeklyLimitsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <LimitsReport kind="weekly" title="Weekly limits report" exportFileBaseName="weekly-limits" pageId="reports-weekly-limits" onNavigate={onNavigate} />
  )
}

export function DailyLimitsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <LimitsReport kind="daily" title="Daily limits report" exportFileBaseName="daily-limits" pageId="reports-daily-limits" onNavigate={onNavigate} />
  )
}
