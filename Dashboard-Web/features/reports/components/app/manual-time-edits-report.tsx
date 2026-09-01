"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ChevronDown, LayoutList } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import {
  ReportEmptyState,
  StandardReportLayout,
  useStandardReportLayout,
} from "@/features/reports/components/app/standard-report-layout"
import { fetchManualTimeEditsReport, type ManualTimeEditRow } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  STANDARD_REPORT_ORG_LABEL,
  STANDARD_REPORT_TIMEZONE_LABEL,
  WORK_SESSIONS_GROUP_BY_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { groupReportRows } from "@/features/reports/utils/report-grouping"

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

function formatHours(hours: number): string {
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  return `${whole}:${String(minutes).padStart(2, "0")}`
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-600",
}

function keyForManualEditGroup(r: ManualTimeEditRow, groupBy: string): string {
  switch (groupBy) {
    case "member":
      return r.memberName
    case "project":
      return r.projectName || "No project"
    case "date":
    default:
      return r.day
  }
}

function ManualTimeEditsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<ManualTimeEditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  // A failed request used to fall through to the empty state, so an
  // outage read as "no data for this range". reloadKey re-runs the fetch
  // when the viewer retries.
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchManualTimeEditsReport({
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      memberIds: [...filters.memberIds],
      projectIds: [...filters.projectIds],
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

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Date", "Member", "Project", "To-do", "Hours", "Billable", "Status", "Reason", "Edited by"]
      const lines = rows.map((r) =>
        [
          r.day,
          r.memberName,
          r.projectName,
          r.taskTitle,
          r.hours.toFixed(2),
          r.billable ? "Yes" : "No",
          r.status,
          r.description,
          r.editedByName,
        ]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `manual-time-edits-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const totalHours = useMemo(() => rows.reduce((sum, r) => sum + r.hours, 0), [rows])

  const grouped = useMemo(
    () => groupReportRows(rows, (r) => keyForManualEditGroup(r, groupBy)),
    [rows, groupBy]
  )

  useEffect(() => {
    const runPdfExport = () => {
      const byMember = new Map<string, number>()
      rows.forEach((r) => byMember.set(r.memberName, (byMember.get(r.memberName) ?? 0) + r.hours))
      downloadReportPdf({
        title: "Manual Time Edits Report",
        subtitle: "Time entered by hand instead of tracked.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        summary: [
          { label: "Entries", value: String(rows.length) },
          { label: "Total hours", value: formatHours(totalHours) },
        ],
        charts:
          byMember.size > 0
            ? [
                {
                  type: "bar",
                  title: "Manual hours by member",
                  data: [...byMember.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })),
                  valueFormatter: (v) => formatHours(v),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Member", key: "member" },
            { header: "Project / To-do", key: "project" },
            { header: "Hours", key: "hours", align: "right" },
            { header: "Billable", key: "billable", align: "center" },
            { header: "Status", key: "status", align: "center" },
            { header: "Reason", key: "reason" },
            { header: "Edited by", key: "editedBy" },
          ],
          rows: rows.map((r) => ({
            date: formatDay(r.day),
            member: r.memberName,
            project: r.taskTitle ? `${r.projectName || "No project"} — ${r.taskTitle}` : r.projectName || "No project",
            hours: formatHours(r.hours),
            billable: r.billable ? "Yes" : "No",
            status: r.status,
            reason: r.description || "—",
            editedBy: r.editedByName || "—",
          })),
          emptyMessage: "No manual time in this range.",
        },
        filename: "manual-time-edits",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, totalHours, dateLabel, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={2} rows={6} columns={6} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No manual time in this range"
        subtitle="Manual entries appear here when someone adds time by hand instead of tracking it."
      />
    )
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border shadow-sm",
        isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed">
          <thead>
            <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
              {[
                ["Date", "w-[12%] text-left"],
                ["Member", "w-[16%] text-left"],
                ["Project / To-do", "w-[20%] text-left"],
                ["Hours", "w-[8%] text-right"],
                ["Billable", "w-[8%] text-center"],
                ["Status", "w-[10%] text-center"],
                ["Reason", "w-[16%] text-left"],
                ["Edited by", "w-[10%] text-left"],
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
            {grouped.map((g) => (
              <Fragment key={g.key}>
                <tr className={cn(isDark ? "bg-white/10" : "bg-slate-100")}>
                  <td colSpan={8} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(g.key)}
                      className={cn(
                        "flex w-full items-center gap-2 text-left text-sm font-medium",
                        isDark ? "text-[#dce1fb]" : "text-slate-800"
                      )}
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
                  ? g.rows.map((r) => (
                      <tr key={r.id} className={cn(
                          "border-b transition-colors",
                          isDark ? "border-white/5 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                        )}>
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
                        <td className="px-4 py-3">
                          <div className={cn("truncate text-sm", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                            {r.projectName || "No project"}
                          </div>
                          {r.taskTitle ? (
                            <div className={cn("truncate text-xs", isDark ? "text-white/40" : "text-slate-400")}>
                              {r.taskTitle}
                            </div>
                          ) : null}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right text-sm tabular-nums",
                            isDark ? "text-[#dce1fb]" : "text-slate-800"
                          )}
                        >
                          {formatHours(r.hours)}
                        </td>
                        <td className={cn("px-4 py-3 text-center text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {r.billable ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                              STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"
                            )}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td
                          className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}
                          title={r.description}
                        >
                          {r.description || "—"}
                        </td>
                        <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {r.editedByName || "—"}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
            <tr className={cn("border-t-2 font-semibold", isDark ? "border-white/10" : "border-slate-200")}>
              <td colSpan={3} className={cn("px-4 py-3 text-sm", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Total ({rows.length} {rows.length === 1 ? "entry" : "entries"})
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right text-sm tabular-nums",
                  isDark ? "text-[#dce1fb]" : "text-slate-900"
                )}
              >
                {formatHours(totalHours)}
              </td>
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ManualTimeEditsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Manual time edits report"
      onNavigate={onNavigate}
      exportFileBaseName="manual-time-edits"
      pageId="reports-manual-edits"
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={WORK_SESSIONS_GROUP_BY_OPTIONS}
      filtersPanel={(close) => (
        <ReportFiltersPanel onClose={close} options={options} value={filters} onChange={setFilters} />
      )}
    >
      <ManualTimeEditsTable filters={filters} />
    </StandardReportLayout>
  )
}
