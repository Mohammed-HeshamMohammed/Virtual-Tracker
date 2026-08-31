"use client"

import { useEffect, useMemo, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import {
  ReportEmptyState,
  StandardReportLayout,
  useStandardReportLayout,
} from "@/features/reports/components/app/standard-report-layout"
import { fetchWorkBreaksReport, type WorkBreakRow } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, STANDARD_REPORT_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"
import { formatDecimalHoursClock } from "@/features/reports/utils/time-and-activity"

function initialsFor(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??"
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatClock(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function WorkBreaksTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<WorkBreakRow[]>([])
  const [minGapMinutes, setMinGapMinutes] = useState(5)
  const [loading, setLoading] = useState(true)
  // A failed request used to fall through to the empty state, so an
  // outage read as "no data for this range". reloadKey re-runs the fetch
  // when the viewer retries.
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWorkBreaksReport({
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      memberIds: [...filters.memberIds],
      minGapMinutes,
    })
      .then((data) => {
        if (!cancelled) setRows(data.rows)
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
  }, [rangeStart, rangeEnd, filters, minGapMinutes, reloadKey])

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Date", "Member", "Break start", "Break end", "Duration (min)"]
      const lines = rows.map((r) =>
        [r.day, r.memberName, formatClock(r.startedAt), formatClock(r.endedAt), Math.round(r.durationSeconds / 60)]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `work-breaks-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const perMemberSeconds = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => m.set(r.memberName, (m.get(r.memberName) ?? 0) + r.durationSeconds))
    return m
  }, [rows])

  const summary = useMemo(() => {
    const totalSeconds = rows.reduce((sum, r) => sum + r.durationSeconds, 0)
    return {
      totalSeconds,
      count: rows.length,
      avgSeconds: rows.length > 0 ? Math.round(totalSeconds / rows.length) : 0,
      members: perMemberSeconds.size,
    }
  }, [rows, perMemberSeconds])

  useEffect(() => {
    const runPdfExport = () => {
      const byMember = [...perMemberSeconds.entries()].sort(([, a], [, b]) => b - a)
      downloadReportPdf({
        title: "Work Breaks Report",
        subtitle: "How many breaks team members are taking, derived from the gaps between tracked sessions.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        summary: [
          { label: "Breaks", value: String(summary.count) },
          { label: "Total", value: formatDuration(summary.totalSeconds) },
          { label: "Average", value: formatDuration(summary.avgSeconds) },
          { label: "Members", value: String(summary.members) },
        ],
        charts:
          byMember.length > 0
            ? [
                {
                  type: "bar",
                  title: "Break time by member",
                  data: byMember.map(([label, seconds]) => ({ label, value: Math.round((seconds / 3600) * 100) / 100 })),
                  valueFormatter: formatDecimalHoursClock,
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Member", key: "member" },
            { header: "Break start", key: "start" },
            { header: "Break end", key: "end" },
            { header: "Duration", key: "duration", align: "right" },
          ],
          rows: rows.map((r) => ({
            date: formatDay(r.day),
            member: r.memberName,
            start: formatClock(r.startedAt),
            end: formatClock(r.endedAt),
            duration: formatDuration(r.durationSeconds),
          })),
          emptyMessage: "No breaks in this range.",
        },
        filename: "work-breaks",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, perMemberSeconds, summary, dateLabel, registerPdfExportHandler])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={cn("text-xs font-semibold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}
          htmlFor="min-gap"
        >
          Count gaps of at least
        </label>
        <select
          id="min-gap"
          value={minGapMinutes}
          onChange={(e) => setMinGapMinutes(Number(e.target.value))}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm outline-none",
            isDark ? "border-white/10 bg-white/5 text-[#dce1fb]" : "border-slate-200 bg-white text-slate-700"
          )}
        >
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading ? (
        <ReportTableSkeleton rows={6} columns={5} />
      ) : rows.length === 0 ? (
        <ReportEmptyState
          title="No breaks in this range"
          subtitle="Breaks are the gaps between tracked sessions on the same day. Try a shorter minimum gap."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Breaks", String(summary.count)],
              ["Total", formatDuration(summary.totalSeconds)],
              ["Average", formatDuration(summary.avgSeconds)],
              ["Members", String(summary.members)],
            ].map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border px-4 py-3 shadow-sm",
                  isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wider",
                    isDark ? "text-white/40" : "text-slate-400"
                  )}
                >
                  {label}
                </div>
                <div className={cn("mt-1 text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div
            className={cn(
              "overflow-hidden rounded-xl border shadow-sm",
              isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
            )}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed">
                <thead>
                  <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
                    {[
                      ["Date", "w-[22%] text-left"],
                      ["Member", "w-[28%] text-left"],
                      ["Break start", "w-[17%] text-left"],
                      ["Break end", "w-[17%] text-left"],
                      ["Duration", "w-[16%] text-right"],
                    ].map(([label, cls]) => (
                      <th
                        key={label}
                        className={cn(
                          "px-4 py-3 text-sm font-semibold",
                          cls,
                          isDark ? "text-[#dce1fb]" : "text-slate-700"
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.memberId}-${r.startedAt}-${i}`}
                      className={cn(
                  "border-b transition-colors",
                  isDark ? "border-white/5 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                )}
                    >
                      <td
                        className={cn(
                          "px-4 py-3 text-sm whitespace-nowrap",
                          isDark ? "text-[#bccbb9]" : "text-slate-600"
                        )}
                      >
                        {formatDay(r.day)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ReportMemberAvatar initials={initialsFor(r.memberName)} />
                          <span className={cn("truncate text-sm", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                            {r.memberName}
                          </span>
                        </div>
                      </td>
                      <td className={cn("px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                        {formatClock(r.startedAt)}
                      </td>
                      <td className={cn("px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                        {formatClock(r.endedAt)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right text-sm tabular-nums",
                          isDark ? "text-[#dce1fb]" : "text-slate-800"
                        )}
                      >
                        {formatDuration(r.durationSeconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function WorkBreaksReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Work breaks report"
      onNavigate={onNavigate}
      exportFileBaseName="work-breaks"
      pageId="reports-work-breaks"
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
      <WorkBreaksTable filters={filters} />
    </StandardReportLayout>
  )
}
