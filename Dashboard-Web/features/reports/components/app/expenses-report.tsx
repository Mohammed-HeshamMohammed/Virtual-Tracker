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
import { fetchExpensesReport, type ExpenseReportRow } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportErrorState, ReportSkeleton, ReportTruncationNotice } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  STANDARD_REPORT_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  CALENDAR_DATE_LABEL,
} from "@/features/reports/components/shared/constants"
import { groupReportRows } from "@/features/reports/utils/report-grouping"

import { toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
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

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
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

function keyForExpenseGroup(r: ExpenseReportRow, groupBy: string): string {
  switch (groupBy) {
    case "member":
      return r.memberName
    case "project":
      return r.projectName || "No project"
    case "client":
      return r.clientName || "No client"
    case "date":
    default:
      return r.day
  }
}

function ExpensesTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<ExpenseReportRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchExpensesReport({
      from: toDateParam(rangeStart),
      to: toDateParam(rangeEnd),
      memberIds: [...filters.memberIds],
      projectIds: [...filters.projectIds],
    })
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
    registerExportHandler(() => {
      const header = ["Date", "Member", "Project", "Category", "Description", "Amount", "Billable", "Status"]
      const lines = rows.map((r) =>
        [r.day, r.memberName, r.projectName, r.category, r.description, r.amount.toFixed(2), r.billable ? "Yes" : "No", r.status]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `expenses-${todayDateParam()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const summary = useMemo(() => {
    const currency = rows[0]?.currency ?? "USD"
    const total = rows.reduce((s, r) => s + r.amount, 0)
    const approved = rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.amount, 0)
    const pending = rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0)
    const billable = rows.filter((r) => r.billable).reduce((s, r) => s + r.amount, 0)
    const mixed = new Set(rows.map((r) => r.currency)).size > 1
    return { currency, total, approved, pending, billable, mixed }
  }, [rows])

  const grouped = useMemo(
    () => groupReportRows(rows, (r) => keyForExpenseGroup(r, groupBy)),
    [rows, groupBy]
  )

  useEffect(() => {
    const runPdfExport = () => {
      const byCategory = new Map<string, number>()
      rows.forEach((r) => byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount))
      downloadReportPdf({
        title: "Expenses Report",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: CALENDAR_DATE_LABEL,
        rangeLabel: dateLabel,
        summary: !summary.mixed
          ? [
              { label: "Total", value: money(summary.total, summary.currency) },
              { label: "Approved", value: money(summary.approved, summary.currency) },
              { label: "Pending", value: money(summary.pending, summary.currency) },
              { label: "Billable", value: money(summary.billable, summary.currency) },
            ]
          : undefined,
        charts:
          !summary.mixed && byCategory.size > 0
            ? [
                {
                  type: "bar",
                  title: "Spend by category",
                  data: [...byCategory.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .map(([label, value]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), value })),
                  valueFormatter: (v) => money(v, summary.currency),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Member", key: "member" },
            { header: "Project", key: "project" },
            { header: "Category", key: "category" },
            { header: "Description", key: "description" },
            { header: "Amount", key: "amount", align: "right" },
            { header: "Billable", key: "billable", align: "center" },
            { header: "Status", key: "status" },
          ],
          rows: rows.map((r) => ({
            date: formatDay(r.day),
            member: r.memberName,
            project: r.projectName || "—",
            category: r.category,
            description: r.description,
            amount: money(r.amount, r.currency),
            billable: r.billable ? "Yes" : "No",
            status: r.status,
          })),
          emptyMessage: "No expenses in this range.",
        },
        filename: "expenses",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, summary, dateLabel, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={3} rows={6} columns={6} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No expenses in this range"
        subtitle="Expenses appear here once someone submits one from the Financials page."
      />
    )
  }

  return (
    <div className="space-y-5">
      {truncated ? <ReportTruncationNotice what="expenses" /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total", summary.total],
          ["Approved", summary.approved],
          ["Pending", summary.pending],
          ["Billable", summary.billable],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className={cn(
              "rounded-xl border px-4 py-3 shadow-sm",
              isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
            )}
          >
            <div className={cn("text-[10px] font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
              {label}
            </div>
            <div className={cn("mt-1 text-lg font-semibold tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
              {summary.mixed ? "—" : money(Number(value), summary.currency)}
            </div>
          </div>
        ))}
      </div>
      {summary.mixed ? (
        <p className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>
          Totals are hidden because this range mixes currencies.
        </p>
      ) : null}

      <div
        className={cn(
          "overflow-hidden rounded-xl border shadow-sm",
          isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
        )}
      >
        <div className="overflow-x-auto custom-scrollbar-x">
          <table className="w-full min-w-[880px] table-fixed">
            <thead>
              <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
                {[
                  ["Date", "w-[12%] text-left"],
                  ["Member", "w-[16%] text-left"],
                  ["Project", "w-[14%] text-left"],
                  ["Category", "w-[11%] text-left"],
                  ["Description", "w-[19%] text-left"],
                  ["Amount", "w-[12%] text-right"],
                  ["Billable", "w-[8%] text-center"],
                  ["Status", "w-[8%] text-center"],
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
                              <ReportMemberAvatar initials={initialsFor(r.memberName)} imageUrl={r.memberAvatarUrl} />
                              <span className={cn("truncate text-sm", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                                {r.memberName}
                              </span>
                            </div>
                          </td>
                          <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {r.projectName || "—"}
                          </td>
                          <td className={cn("px-4 py-3 text-sm capitalize", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {r.category}
                          </td>
                          <td
                            className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}
                            title={r.description}
                          >
                            {r.description}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right text-sm tabular-nums",
                              isDark ? "text-[#dce1fb]" : "text-slate-800"
                            )}
                          >
                            {money(r.amount, r.currency)}
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

export function ExpensesReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Expenses report"
      onNavigate={onNavigate}
      exportFileBaseName="expenses"
      pageId="reports-expenses"
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={STANDARD_REPORT_GROUP_BY_OPTIONS}
      filtersPanel={(close) => (
        <ReportFiltersPanel onClose={close} options={options} value={filters} onChange={setFilters} />
      )}
    >
      <ExpensesTable filters={filters} />
    </StandardReportLayout>
  )
}
