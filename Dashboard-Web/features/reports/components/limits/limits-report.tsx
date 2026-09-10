"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ChevronDown, LayoutList } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchWeeklyLimitsReport, fetchDailyLimitsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { LimitPeriodRow, LimitUsageRow } from "@/features/reports/models/limits"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  LIMITS_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  MEMBER_TIMEZONE_LABEL,
} from "@/features/reports/components/shared/constants"
import { toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"

function groupLimitRows(rows: LimitUsageRow[]): { key: string; label: string; rows: LimitUsageRow[] }[] {
  return rows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ key: row.memberId, label: row.name, rows: [row] }))
}

function LimitsTable({ kind, filters }: { kind: "weekly" | "daily"; filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<LimitUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    const from = toDateParam(rangeStart)
    const to = toDateParam(rangeEnd)
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
      const periodHeader = kind === "weekly" ? "Week starting" : "Day"
      const header = ["Member", periodHeader, "Tracked hours", "Limit (hrs)", "% used", "Over limit", "Partial period"]
      const lines = rows.flatMap((r) =>
        r.periodRows.map((p) =>
          [
            r.name,
            p.periodStart,
            p.trackedHours.toFixed(2),
            p.limitHours.toFixed(2),
            p.limitHours > 0 ? `${p.pctUsed}%` : "",
            p.overLimit ? "Yes" : "No",
            p.partial ? "Yes" : "No",
          ]
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(",")
        )
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-limits-${todayDateParam()}.csv`
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
      const periodHeader = kind === "weekly" ? "Week of" : "Day"
      downloadReportPdf({
        title: kind === "weekly" ? "Weekly Limits Report" : "Daily Limits Report",
        subtitle: `Tracked hours against each member's ${kind} limit, one row per ${kind === "weekly" ? "week" : "day"}.`,
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: MEMBER_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        charts:
          withLimit.length > 0
            ? [
                {
                  type: "progress",
                  title: `Highest ${limitLabel.toLowerCase()} usage in range`,
                  rows: withLimit
                    .slice()
                    .sort((a, b) => b.peakPctUsed - a.peakPctUsed)
                    .map((r) => ({
                      label: r.name,
                      pct: r.peakPctUsed,
                      sublabel:
                        r.periodsOverLimit > 0
                          ? `Over limit in ${r.periodsOverLimit} of ${r.periods}`
                          : `Within limit in all ${r.periods}`,
                    })),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Member", key: "member" },
            { header: periodHeader, key: "period" },
            { header: "Tracked", key: "tracked", align: "right" },
            { header: limitLabel, key: "limit", align: "right" },
            { header: "% used", key: "pct", align: "right" },
          ],
          rows: rows.flatMap((r) =>
            r.periodRows.map((p) => ({
              member: r.name,
              period: p.partial ? `${p.periodStart} (partial)` : p.periodStart,
              tracked: `${p.trackedHours.toFixed(1)}h`,
              limit: p.limitHours > 0 ? `${p.limitHours.toFixed(1)}h` : "No limit set",
              pct: p.limitHours > 0 ? `${p.pctUsed}%` : "—",
            }))
          ),
          emptyMessage: `No members with a ${kind} limit set.`,
        },
        filename: `${kind}-limits`,
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, kind, dateLabel, registerPdfExportHandler])

  const grouped = useMemo(() => groupLimitRows(rows), [rows, groupBy])

  if (loading) return <ReportTableSkeleton rows={6} columns={3} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  const periodHeader = kind === "weekly" ? "Week" : "Day"
  const limitHeader = kind === "weekly" ? "Weekly limit" : "Daily limit"

  function formatPeriod(row: LimitPeriodRow): string {
    const fmt = (day: string) =>
      new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    return kind === "weekly" ? `${fmt(row.periodStart)} - ${fmt(row.periodEnd)}` : fmt(row.periodStart)
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Member</th>
            <th className={th}>{periodHeader}</th>
            <th className={cn(th, "text-right")}>Tracked</th>
            <th className={cn(th, "min-w-48")}>{limitHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No tracked time against a {kind} limit in this range.
              </td>
            </tr>
          ) : null}
          {grouped.map((g) => (
            <Fragment key={g.key}>
              <tr className={cn(isDark ? "bg-white/6" : "bg-slate-100")}>
                <td colSpan={4} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(g.key)}
                    className={cn("flex w-full items-center gap-2 text-left text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}
                  >
                    <LayoutList className={cn("h-4 w-4 shrink-0", isDark ? "text-white/45" : "text-slate-500")} />
                    <span>{g.label}</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 transition-transform",
                        isDark ? "text-white/40" : "text-slate-400",
                        collapsedGroups.has(g.key) && "-rotate-90"
                      )}
                    />
                  </button>
                </td>
              </tr>
              {!collapsedGroups.has(g.key)
                ? g.rows.flatMap((row) =>
                    row.periodRows.map((period, i) => (
                      <tr
                        key={`${row.memberId}-${period.periodStart}`}
                        className={cn(
                          "border-b last:border-b-0",
                          isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                        )}
                      >
                        <td className="px-4 py-3.5">
                          {/* The member is named once and the periods listed
                              beneath, so a row reads as "this week" rather
                              than as a second total for the same person. */}
                          {i === 0 ? (
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                                {row.initials}
                              </span>
                              <div>
                                <div className={cn("font-medium", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{row.name}</div>
                                <div className={cn("text-xs", isDark ? "text-white/40" : "text-slate-500")}>
                                  {row.periodsOverLimit > 0
                                    ? `Over limit in ${row.periodsOverLimit} of ${row.periods}`
                                    : `Within limit in all ${row.periods}`}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </td>
                        <td className={cn("whitespace-nowrap px-4 py-3.5", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {formatPeriod(period)}
                          {period.partial ? (
                            <span className={cn("ml-2 text-xs", isDark ? "text-white/35" : "text-slate-400")}>partial</span>
                          ) : null}
                        </td>
                        <td className={cn("px-4 py-3.5 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                          {period.trackedHours.toFixed(1)}h
                        </td>
                        <td className="px-4 py-3.5">
                          {period.limitHours > 0 ? (
                            <div className="space-y-2">
                              <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                                {period.limitHours.toFixed(1)}h
                              </div>
                              <div className={cn("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-white/10" : "bg-slate-200")}>
                                <div
                                  className={cn("h-full rounded-full transition-[width]", period.overLimit ? "bg-red-500" : "bg-blue-500")}
                                  style={{ width: `${Math.min(100, period.pctUsed)}%` }}
                                />
                              </div>
                              <div
                                className={cn(
                                  "text-xs tabular-nums",
                                  period.overLimit ? "text-red-500" : isDark ? "text-white/45" : "text-slate-500"
                                )}
                              >
                                {period.pctUsed}%
                                {period.overLimit
                                  ? ` - ${(period.trackedHours - period.limitHours).toFixed(1)}h over`
                                  : ""}
                              </div>
                            </div>
                          ) : (
                            <span className={cn("text-sm", isDark ? "text-white/40" : "text-slate-400")}>No limit set</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )
                : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
      showGroupBy={true}
      groupByOptions={LIMITS_GROUP_BY_OPTIONS}
      defaultGroupBy="member"
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
