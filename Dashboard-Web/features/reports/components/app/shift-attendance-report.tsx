"use client"

import { useEffect, useMemo, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import {
  ReportEmptyState,
  StandardReportLayout,
  useStandardReportLayout,
} from "@/features/reports/components/app/standard-report-layout"
import { fetchShiftAttendanceReport, type ShiftAttendanceRow } from "@/features/reports/api/misc-reports-api"
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

function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, "0")}`
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

const STATUS_STYLE: Record<string, string> = {
  worked: "bg-emerald-50 text-emerald-600",
  missed: "bg-red-50 text-red-600",
  unscheduled: "bg-amber-50 text-amber-600",
}

const STATUS_LABEL: Record<string, string> = {
  worked: "Worked",
  missed: "Missed",
  unscheduled: "Unscheduled",
}

function ShiftAttendanceTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<ShiftAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  // A failed request used to fall through to the empty state, so an
  // outage read as "no data for this range". reloadKey re-runs the fetch
  // when the viewer retries.
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [statusFilter, setStatusFilter] = useState<"all" | "worked" | "missed" | "unscheduled">("all")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchShiftAttendanceReport({
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      memberIds: [...filters.memberIds],
    })
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
  }, [rangeStart, rangeEnd, filters, reloadKey])

  const visible = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  )

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Date", "Member", "Scheduled", "Status", "Tracked"]
      const lines = visible.map((r) =>
        [r.day, r.memberName, r.scheduled ? "Yes" : "No", r.status, hours(r.activeSeconds)]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `shift-attendance-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [visible, registerExportHandler])

  const summary = useMemo(() => {
    const worked = rows.filter((r) => r.status === "worked").length
    const missed = rows.filter((r) => r.status === "missed").length
    const unscheduled = rows.filter((r) => r.status === "unscheduled").length
    const scheduled = worked + missed
    return {
      worked,
      missed,
      unscheduled,
      rate: scheduled > 0 ? Math.round((worked / scheduled) * 100) : 0,
    }
  }, [rows])

  useEffect(() => {
    const runPdfExport = () => {
      downloadReportPdf({
        title: "Shift Attendance Report",
        subtitle: "Configured working days against days actually tracked, in each member's own timezone.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        summary: [
          { label: "Worked", value: String(summary.worked) },
          { label: "Missed", value: String(summary.missed) },
          { label: "Unscheduled", value: String(summary.unscheduled) },
          { label: "Attendance", value: `${summary.rate}%` },
        ],
        charts: [
          {
            type: "bar",
            title: "Days by status",
            data: [
              { label: "Worked", value: summary.worked },
              { label: "Missed", value: summary.missed },
              { label: "Unscheduled", value: summary.unscheduled },
            ],
          },
        ],
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Member", key: "member" },
            { header: "Scheduled", key: "scheduled", align: "center" },
            { header: "Status", key: "status", align: "center" },
            { header: "Tracked", key: "tracked", align: "right" },
          ],
          rows: visible.map((r) => ({
            date: formatDay(r.day),
            member: r.memberName,
            scheduled: r.scheduled ? "Yes" : "No",
            status: STATUS_LABEL[r.status] ?? r.status,
            tracked: r.activeSeconds > 0 ? hours(r.activeSeconds) : "—",
          })),
          emptyMessage: "Nothing to report for this range.",
        },
        filename: "shift-attendance",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [visible, summary, dateLabel, registerPdfExportHandler])

  return (
    <div className="space-y-5">
      <p className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>
        Attendance compares each member&apos;s configured working days against the days they actually tracked time,
        in their own timezone. No shift start times are configured anywhere in this workspace, so lateness is not
        reported.
      </p>

      {error ? (
        <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading ? (
        <ReportTableSkeleton rows={6} columns={6} />
      ) : rows.length === 0 ? (
        <ReportEmptyState
          title="Nothing to report"
          subtitle="No scheduled days or tracked time fall inside this range."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Worked", String(summary.worked)],
              ["Missed", String(summary.missed)],
              ["Unscheduled", String(summary.unscheduled)],
              ["Attendance", `${summary.rate}%`],
            ].map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border px-4 py-3 shadow-sm",
                  isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
                )}
              >
                <div className={cn("text-[10px] font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
                  {label}
                </div>
                <div className={cn("mt-1 text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {(["all", "worked", "missed", "unscheduled"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
                  statusFilter === s
                    ? "bg-blue-500 text-white"
                    : isDark
                      ? "text-white/40 hover:bg-white/5"
                      : "text-slate-500 hover:bg-slate-100"
                )}
              >
                {s}
              </button>
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
                      ["Date", "w-[24%] text-left"],
                      ["Member", "w-[30%] text-left"],
                      ["Scheduled", "w-[15%] text-center"],
                      ["Status", "w-[16%] text-center"],
                      ["Tracked", "w-[15%] text-right"],
                    ].map(([label, cls]) => (
                      <th
                        key={label}
                        className={cn("px-4 py-3 text-sm font-semibold", cls, isDark ? "text-[#dce1fb]" : "text-slate-700")}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr
                      key={`${r.memberId}-${r.day}-${i}`}
                      className={cn(
                  "border-b transition-colors",
                  isDark ? "border-white/5 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                )}
                    >
                      <td className={cn("px-4 py-3 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
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
                      <td className={cn("px-4 py-3 text-center text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                        {r.scheduled ? "Yes" : "No"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"
                          )}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right text-sm tabular-nums",
                          isDark ? "text-[#dce1fb]" : "text-slate-800"
                        )}
                      >
                        {r.activeSeconds > 0 ? hours(r.activeSeconds) : "—"}
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

export function ShiftAttendanceReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Shift attendance report"
      onNavigate={onNavigate}
      exportFileBaseName="shift-attendance"
      pageId="reports-shift-attendance"
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
      <ShiftAttendanceTable filters={filters} />
    </StandardReportLayout>
  )
}
