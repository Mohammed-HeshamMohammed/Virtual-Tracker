"use client"

import { useEffect, useState } from "react"
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

function TimesheetApprovalsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, registerExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<TimesheetApprovalRow[]>([])

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    fetchTimesheetApprovalsReport({ from, to, memberIds: [...filters.memberIds] }).then((data) => {
      if (!cancelled) setRows(data)
    })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd, filters])

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
      a.download = `timesheet-approvals-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
              <th className={th}>Member</th>
              <th className={th}>Period</th>
              <th className={th}>Status</th>
              <th className={cn(th, "text-right")}>Total hours</th>
              <th className={cn(th, "text-right")}>Billable</th>
              <th className={th}>Approved by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                  No timesheets in this date range.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
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
                <td className={cn("px-4 py-3.5 whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                  {formatDateLabel(row.periodStart)} – {formatDateLabel(row.periodEnd)}
                </td>
                <td className="px-4 py-3.5">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", statusBadgeClass(row.status))}>
                    {row.status}
                  </span>
                </td>
                <td className={cn("px-4 py-3.5 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                  {row.totalHours.toFixed(2)}h
                </td>
                <td className={cn("px-4 py-3.5 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                  {row.billableHours.toFixed(2)}h
                </td>
                <td className={cn("px-4 py-3.5", isDark ? "text-[#bccbb9]" : "text-slate-600")}>{row.approvedByName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <TimesheetApprovalsTable filters={filters} />
    </StandardReportLayout>
  )
}
