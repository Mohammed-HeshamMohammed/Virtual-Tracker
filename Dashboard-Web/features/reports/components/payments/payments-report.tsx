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
import { fetchPaymentsRecordedReport, type PaymentReportRow } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  PAYMENTS_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  CALENDAR_DATE_LABEL,
} from "@/features/reports/components/shared/constants"
import { toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"

function groupPaymentRows(
  rows: PaymentReportRow[],
  groupBy: string
): { key: string; label: string; rows: PaymentReportRow[] }[] {
  function keyFor(r: PaymentReportRow): string {
    switch (groupBy) {
      case "date":
        return r.paidOn
      case "member":
        return r.kind === "team" ? r.memberName || "Unknown member" : "Received from clients"
      case "client":
        return r.kind === "client" ? r.clientName || "Unknown client" : "Paid to team members"
      default:
        return r.paidOn
    }
  }
  const order: string[] = []
  const map = new Map<string, PaymentReportRow[]>()
  for (const r of rows) {
    const k = keyFor(r)
    if (!map.has(k)) {
      map.set(k, [])
      order.push(k)
    }
    map.get(k)!.push(r)
  }
  if (groupBy === "date") order.sort((a, b) => a.localeCompare(b))
  return order.map((key) => ({ key, label: key, rows: map.get(key) ?? [] }))
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

function PaymentsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<PaymentReportRow[]>([])
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
    setLoading(true)
    setError(null)
    fetchPaymentsRecordedReport({
      from: toDateParam(rangeStart),
      to: toDateParam(rangeEnd),
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

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Date", "Invoice", "Direction", "Paid to / from", "Method", "Reference", "Amount"]
      const lines = rows.map((r) =>
        [
          r.paidOn,
          r.invoiceNumber,
          r.kind === "client" ? "Received" : "Paid out",
          r.kind === "client" ? r.clientName : r.memberName,
          r.method,
          r.reference,
          r.amount.toFixed(2),
        ]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `payments-${todayDateParam()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const summary = useMemo(() => {
    const currency = rows[0]?.currency ?? "USD"
    const mixed = new Set(rows.map((r) => r.currency)).size > 1
    const received = rows.filter((r) => r.kind === "client").reduce((s, r) => s + r.amount, 0)
    const paidOut = rows.filter((r) => r.kind === "team").reduce((s, r) => s + r.amount, 0)
    return { currency, mixed, received, paidOut, net: received - paidOut }
  }, [rows])

  const grouped = useMemo(() => groupPaymentRows(rows, groupBy), [rows, groupBy])

  useEffect(() => {
    const runPdfExport = () => {
      const byMethod = new Map<string, number>()
      rows.forEach((r) => byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amount))
      downloadReportPdf({
        title: "Payments Report",
        subtitle: "Money actually recorded against an invoice.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: CALENDAR_DATE_LABEL,
        rangeLabel: dateLabel,
        summary: !summary.mixed
          ? [
              { label: "Received", value: money(summary.received, summary.currency) },
              { label: "Paid out", value: money(summary.paidOut, summary.currency) },
              { label: "Net", value: money(summary.net, summary.currency) },
            ]
          : undefined,
        charts:
          !summary.mixed && byMethod.size > 0
            ? [
                {
                  type: "bar",
                  title: "Amount by payment method",
                  data: [...byMethod.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .map(([label, value]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), value })),
                  valueFormatter: (v) => money(v, summary.currency),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Invoice", key: "invoice" },
            { header: "Direction", key: "direction" },
            { header: "Paid to / from", key: "party" },
            { header: "Method", key: "method" },
            { header: "Reference", key: "reference" },
            { header: "Amount", key: "amount", align: "right" },
          ],
          rows: rows.map((r) => ({
            date: formatDay(r.paidOn),
            invoice: r.invoiceNumber,
            direction: r.kind === "client" ? "Received" : "Paid out",
            party: (r.kind === "client" ? r.clientName : r.memberName) || "—",
            method: r.method,
            reference: r.reference || "—",
            amount: money(r.amount, r.currency),
          })),
          emptyMessage: "No payments in this range.",
        },
        filename: "payments",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, summary, dateLabel, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={3} rows={6} columns={7} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No payments in this range"
        subtitle="Payments appear here once they are recorded against an invoice."
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Received", summary.received, "text-emerald-600"],
          ["Paid out", summary.paidOut, "text-red-500"],
          ["Net", summary.net, summary.net >= 0 ? "text-emerald-600" : "text-red-500"],
        ].map(([label, value, tone]) => (
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
            <div className={cn("mt-1 text-lg font-semibold tabular-nums", String(tone))}>
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
          <table className="w-full min-w-[820px] table-fixed">
            <thead>
              <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
                {[
                  ["Date", "w-[14%] text-left"],
                  ["Invoice", "w-[14%] text-left"],
                  ["Direction", "w-[12%] text-center"],
                  ["Paid to / from", "w-[22%] text-left"],
                  ["Method", "w-[12%] text-left"],
                  ["Reference", "w-[14%] text-left"],
                  ["Amount", "w-[12%] text-right"],
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
                  <tr className={cn(isDark ? "bg-white/6" : "bg-slate-100")}>
                    <td colSpan={7} className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(g.key)}
                        className={cn("flex w-full items-center gap-2 text-left text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}
                      >
                        <LayoutList className={cn("h-4 w-4 shrink-0", isDark ? "text-white/45" : "text-slate-500")} />
                        <span>{groupBy === "date" ? formatDay(g.label) : g.label}</span>
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
                            {formatDay(r.paidOn)}
                          </td>
                          <td className={cn("px-4 py-3 text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                            {r.invoiceNumber}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                r.kind === "client" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                              )}
                            >
                              {r.kind === "client" ? "Received" : "Paid out"}
                            </span>
                          </td>
                          <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {r.kind === "client" ? r.clientName || "—" : r.memberName || "—"}
                          </td>
                          <td className={cn("px-4 py-3 text-sm capitalize", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {r.method}
                          </td>
                          <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {r.reference || "—"}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right text-sm font-semibold tabular-nums",
                              r.kind === "client" ? "text-emerald-600" : "text-red-500"
                            )}
                          >
                            {money(r.amount, r.currency)}
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

export function PaymentsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Payments report"
      onNavigate={onNavigate}
      exportFileBaseName="payments"
      pageId="reports-payments"
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={PAYMENTS_GROUP_BY_OPTIONS}
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
      <PaymentsTable filters={filters} />
    </StandardReportLayout>
  )
}
