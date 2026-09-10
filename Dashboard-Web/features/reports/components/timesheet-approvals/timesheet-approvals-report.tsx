"use client"

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown, LayoutList } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchTimesheetApprovalsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { TimesheetApprovalRow, TimesheetStatus } from "@/features/reports/models/timesheet-approvals"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton, ReportTruncationNotice } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  STANDARD_REPORT_ORG_LABEL,
  CALENDAR_DATE_LABEL,
  TIMESHEET_APPROVALS_GROUP_BY_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { useReportColumnAutoHide } from "@/features/reports/hooks/use-report-column-auto-hide"

import { toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
function groupTimesheetRows(
  rows: TimesheetApprovalRow[],
  groupBy: string
): { key: string; label: string; rows: TimesheetApprovalRow[] }[] {
  function keyFor(r: TimesheetApprovalRow): string {
    switch (groupBy) {
      case "member":
        return r.memberName
      case "status":
        return r.status
      case "date":
      default:
        return r.periodStart
    }
  }
  const order: string[] = []
  const map = new Map<string, TimesheetApprovalRow[]>()
  for (const r of rows) {
    const k = keyFor(r)
    if (!map.has(k)) {
      map.set(k, [])
      order.push(k)
    }
    map.get(k)!.push(r)
  }
  if (groupBy === "date") order.sort((a, b) => a.localeCompare(b))
  return order.map((key) => ({
    key,
    label: groupBy === "status" ? key.charAt(0).toUpperCase() + key.slice(1) : key,
    rows: map.get(key) ?? [],
  }))
}

function statusBadgeClass(status: TimesheetStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800"
    case "rejected":
      return "bg-red-100 text-red-800"
    case "submitted":
      return "bg-amber-100 text-amber-800"
    case "draft":
    default:
      return "bg-slate-100 text-slate-700"
  }
}

function formatDateLabel(date: string | null): string {
  if (!date) return "—"
  const d = new Date(`${date.length === 10 ? `${date}T00:00:00.000Z` : date}`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const OPTIONAL_COLUMNS: { key: string; header: string; minWidth: number; align?: "right" }[] = [
  { key: "period", header: "Period", minWidth: 160 },
  { key: "status", header: "Status", minWidth: 110 },
  { key: "total_hours", header: "Total hours", minWidth: 100, align: "right" },
  { key: "billable", header: "Billable", minWidth: 90, align: "right" },
  { key: "approved_by", header: "Approved by", minWidth: 130 },
]
const OPTIONAL_COLUMN_MIN_WIDTH = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c.key, c.minWidth]))
const OPTIONAL_COLUMN_HIDE_PRIORITY = ["approved_by", "period", "status", "billable", "total_hours"] as const
const TIMESHEET_APPROVALS_FIXED_WIDTH = 220

function TimesheetApprovalsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { containerRef: tableWidthRef, visibleColumns: fittedColumns } = useReportColumnAutoHide(OPTIONAL_COLUMNS, {
    minWidths: OPTIONAL_COLUMN_MIN_WIDTH,
    hidePriority: OPTIONAL_COLUMN_HIDE_PRIORITY,
    fixedWidth: TIMESHEET_APPROVALS_FIXED_WIDTH,
  })
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<TimesheetApprovalRow[]>([])
  const [truncated, setTruncated] = useState(false)
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
    fetchTimesheetApprovalsReport({ from, to, memberIds: [...filters.memberIds] })
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows)
          setTruncated(data.truncated)
        }
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
    const runExport = () => {
      const header = ["Member", "Period start", "Period end", "Status", "Total hours", "Billable hours", "Approved by"]
      const lines = rows.map((r) =>
        [
          r.memberName,
          r.periodStart,
          r.periodEnd,
          r.status,
          r.totalHours.toFixed(2),
          r.billableHours.toFixed(2),
          r.approvedByName ?? "",
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `timesheet-approvals-${todayDateParam()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  useEffect(() => {
    const runPdfExport = () => {
      const byStatus = new Map<string, number>()
      rows.forEach((r) => byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1))
      downloadReportPdf({
        title: "Timesheet Approvals Report",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: CALENDAR_DATE_LABEL,
        rangeLabel: dateLabel,
        charts:
          byStatus.size > 0
            ? [
                {
                  type: "bar",
                  title: "Timesheets by status",
                  data: [...byStatus.entries()].map(([label, value]) => ({
                    label: label.charAt(0).toUpperCase() + label.slice(1),
                    value,
                  })),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Member", key: "member" },
            { header: "Period", key: "period" },
            { header: "Status", key: "status" },
            { header: "Total hours", key: "total", align: "right" },
            { header: "Billable", key: "billable", align: "right" },
            { header: "Approved by", key: "approvedBy" },
          ],
          rows: rows.map((r) => ({
            member: r.memberName,
            period: `${formatDateLabel(r.periodStart)} – ${formatDateLabel(r.periodEnd)}`,
            status: r.status,
            total: `${r.totalHours.toFixed(2)}h`,
            billable: `${r.billableHours.toFixed(2)}h`,
            approvedBy: r.approvedByName ?? "—",
          })),
          emptyMessage: "No timesheets in this date range.",
        },
        filename: "timesheet-approvals",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, dateLabel, registerPdfExportHandler])

  const grouped = useMemo(() => groupTimesheetRows(rows, groupBy), [rows, groupBy])

  if (loading) return <ReportTableSkeleton rows={6} columns={6} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )
  const colCount = 1 + fittedColumns.length

  function renderOptionalCell(key: string, row: TimesheetApprovalRow): ReactNode {
    switch (key) {
      case "period":
        return `${formatDateLabel(row.periodStart)} – ${formatDateLabel(row.periodEnd)}`
      case "status":
        return (
          <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", statusBadgeClass(row.status))}>
            {row.status}
          </span>
        )
      case "total_hours":
        return `${row.totalHours.toFixed(2)}h`
      case "billable":
        return `${row.billableHours.toFixed(2)}h`
      case "approved_by":
        return row.approvedByName ?? "—"
      default:
        return null
    }
  }

  return (
    <div className="space-y-4">
      {truncated ? <ReportTruncationNotice what="timesheets" /> : null}
      <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <div ref={tableWidthRef} className="overflow-x-auto custom-scrollbar-x">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
              <th className={th}>Member</th>
              {fittedColumns.map((col) => (
                <th key={col.key} className={cn(th, col.align === "right" && "text-right")}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                  No timesheets in this date range.
                </td>
              </tr>
            ) : null}
            {grouped.map((g) => (
              <Fragment key={g.key}>
                <tr className={cn(isDark ? "bg-white/6" : "bg-slate-100")}>
                  <td colSpan={colCount} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(g.key)}
                      className={cn("flex w-full items-center gap-2 text-left text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}
                    >
                      <LayoutList className={cn("h-4 w-4 shrink-0", isDark ? "text-white/45" : "text-slate-500")} />
                      <span>{groupBy === "date" ? formatDateLabel(g.label) : g.label}</span>
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
                  ? g.rows.map((row) => (
                      <tr
                        key={row.id}
                        className={cn("border-b last:border-b-0", isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80")}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                              {row.initials}
                            </span>
                            <span className={cn("font-medium", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{row.memberName}</span>
                          </div>
                        </td>
                        {fittedColumns.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              "px-4 py-3.5",
                              col.align === "right" && "text-right tabular-nums",
                              col.key === "period" && "whitespace-nowrap",
                              isDark ? "text-[#dce1fb]" : "text-slate-800",
                            )}
                          >
                            {renderOptionalCell(col.key, row)}
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

export function TimesheetApprovalsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Timesheet approvals report"
      onNavigate={onNavigate}
      exportFileBaseName="timesheet-approvals"
      pageId="reports-timesheet-approvals"
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={TIMESHEET_APPROVALS_GROUP_BY_OPTIONS}
      defaultGroupBy="date"
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
      <TimesheetApprovalsTable filters={filters} />
    </StandardReportLayout>
  )
}
