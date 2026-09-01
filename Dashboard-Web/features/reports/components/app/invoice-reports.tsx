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
import {
  fetchInvoiceAgingReport,
  fetchInvoicesReport,
  type InvoiceAgingRow,
  type InvoiceReportRow,
} from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  CLIENT_INVOICE_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  STANDARD_REPORT_TIMEZONE_LABEL,
  TEAM_INVOICE_GROUP_BY_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { groupReportRows } from "@/features/reports/utils/report-grouping"

type InvoiceKind = "client" | "team"

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatDay(day: string): string {
  if (!day) return "—"
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-600",
  sent: "bg-blue-50 text-blue-600",
  draft: "bg-slate-100 text-slate-500",
  void: "bg-red-50 text-red-600",
}

const BUCKET_ORDER = ["current", "1-30", "31-60", "61-90", "90+"] as const
const BUCKET_LABEL: Record<string, string> = {
  current: "Not yet due",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
}

const thBase = "px-4 py-3 text-sm font-semibold"

/** Totals across mixed currencies would be meaningless, so they are withheld. */
function useCurrencySummary(rows: { currency: string }[]) {
  return useMemo(() => {
    const currencies = new Set(rows.map((r) => r.currency))
    return { currency: rows[0]?.currency ?? "USD", mixed: currencies.size > 1 }
  }, [rows])
}

// ─── Invoice list ──────────────────────────────────────────────────────────

function keyForInvoiceGroup(r: InvoiceReportRow, groupBy: string): string {
  switch (groupBy) {
    case "member":
      return r.memberName || "—"
    case "client":
      return r.clientName || "—"
    case "date":
    default:
      return r.issueDate
  }
}

function InvoicesTable({ kind, filters }: { kind: InvoiceKind; filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<InvoiceReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchInvoicesReport(kind, {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      memberIds: [...filters.memberIds],
    })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load invoices.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, rangeStart, rangeEnd, filters, reloadKey])

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Number", kind === "client" ? "Client" : "Member", "Issued", "Due", "Status", "Total", "Paid", "Outstanding"]
      const lines = rows.map((r) =>
        [
          r.number,
          kind === "client" ? r.clientName : r.memberName,
          r.issueDate,
          r.dueDate,
          r.status,
          r.total.toFixed(2),
          r.paidAmount.toFixed(2),
          r.dueAmount.toFixed(2),
        ]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-invoices-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, kind, registerExportHandler])

  const { currency, mixed } = useCurrencySummary(rows)
  const totals = useMemo(
    () => ({
      total: rows.reduce((s, r) => s + r.total, 0),
      paid: rows.reduce((s, r) => s + r.paidAmount, 0),
      due: rows.reduce((s, r) => s + r.dueAmount, 0),
    }),
    [rows]
  )

  const grouped = useMemo(
    () => groupReportRows(rows, (r) => keyForInvoiceGroup(r, groupBy)),
    [rows, groupBy]
  )

  useEffect(() => {
    const runPdfExport = () => {
      const partyLabel = kind === "client" ? "Client" : "Member"
      downloadReportPdf({
        title: `${kind === "client" ? "Client" : "Team"} Invoices Report`,
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        summary: !mixed
          ? [
              { label: "Total", value: money(totals.total, currency) },
              { label: "Paid", value: money(totals.paid, currency) },
              { label: "Outstanding", value: money(totals.due, currency) },
            ]
          : undefined,
        charts:
          !mixed && rows.length > 0
            ? [
                {
                  type: "bar",
                  title: `Outstanding by ${partyLabel.toLowerCase()}`,
                  data: (() => {
                    const byParty = new Map<string, number>()
                    rows.forEach((r) => {
                      const label = (kind === "client" ? r.clientName : r.memberName) || "—"
                      byParty.set(label, (byParty.get(label) ?? 0) + r.dueAmount)
                    })
                    return [...byParty.entries()]
                      .sort(([, a], [, b]) => b - a)
                      .map(([label, value]) => ({ label, value }))
                  })(),
                  valueFormatter: (v) => money(v, currency),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Number", key: "number" },
            { header: partyLabel, key: "party" },
            { header: "Issued", key: "issued" },
            { header: "Due", key: "due" },
            { header: "Status", key: "status" },
            { header: "Total", key: "total", align: "right" },
            { header: "Paid", key: "paid", align: "right" },
            { header: "Outstanding", key: "outstanding", align: "right" },
          ],
          rows: rows.map((r) => ({
            number: r.number,
            party: (kind === "client" ? r.clientName : r.memberName) || "—",
            issued: formatDay(r.issueDate),
            due: formatDay(r.dueDate),
            status: r.status,
            total: money(r.total, r.currency),
            paid: money(r.paidAmount, r.currency),
            outstanding: money(r.dueAmount, r.currency),
          })),
          emptyMessage: "No invoices in this range.",
        },
        filename: `${kind}-invoices`,
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, kind, currency, mixed, totals, dateLabel, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={4} rows={6} columns={6} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No invoices in this range"
        subtitle={
          kind === "client"
            ? "Client invoices appear here once they are raised."
            : "Team invoices appear here once they are raised against a member."
        }
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
        <table className="w-full min-w-[860px] table-fixed">
          <thead>
            <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
              {[
                ["Number", "w-[14%] text-left"],
                [kind === "client" ? "Client" : "Member", "w-[20%] text-left"],
                ["Issued", "w-[13%] text-left"],
                ["Due", "w-[13%] text-left"],
                ["Status", "w-[10%] text-center"],
                ["Total", "w-[10%] text-right"],
                ["Paid", "w-[10%] text-right"],
                ["Outstanding", "w-[10%] text-right"],
              ].map(([label, cls]) => (
                <th key={label} className={cn(thBase, cls, isDark ? "text-[#dce1fb]" : "text-slate-700")}>
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
                        <td className={cn("px-4 py-3 text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                          {r.number}
                        </td>
                        <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {kind === "client" ? r.clientName || "—" : r.memberName || "—"}
                        </td>
                        <td className={cn("px-4 py-3 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {formatDay(r.issueDate)}
                        </td>
                        <td className={cn("px-4 py-3 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                          {formatDay(r.dueDate)}
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
                        <td className={cn("px-4 py-3 text-right text-sm tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                          {money(r.total, r.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-600">
                          {money(r.paidAmount, r.currency)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right text-sm font-semibold tabular-nums",
                            r.dueAmount > 0 ? "text-red-500" : isDark ? "text-white/40" : "text-slate-400"
                          )}
                        >
                          {money(r.dueAmount, r.currency)}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
            <tr className={cn("border-t-2 font-semibold", isDark ? "border-white/10" : "border-slate-200")}>
              <td colSpan={5} className={cn("px-4 py-3 text-sm", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Total ({rows.length})
              </td>
              <td className={cn("px-4 py-3 text-right text-sm tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                {mixed ? "—" : money(totals.total, currency)}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-600">
                {mixed ? "—" : money(totals.paid, currency)}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums text-red-500">
                {mixed ? "—" : money(totals.due, currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Aging ─────────────────────────────────────────────────────────────────

function keyForAgingGroup(r: InvoiceAgingRow, groupBy: string): string {
  switch (groupBy) {
    case "member":
      return r.memberName || "—"
    case "client":
      return r.clientName || "—"
    case "date":
    default:
      return r.dueDate
  }
}

function AgingTable({ kind, filters }: { kind: InvoiceKind; filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeEnd, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<InvoiceAgingRow[]>([])
  const [asOf, setAsOf] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const to = rangeEnd.toISOString().slice(0, 10)
    fetchInvoiceAgingReport(kind, { from: to, to, memberIds: [...filters.memberIds] })
      .then((data) => {
        if (cancelled) return
        setRows(data.rows)
        setAsOf(data.asOf)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load aging.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, rangeEnd, filters, reloadKey])

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Number", kind === "client" ? "Client" : "Member", "Due", "Days overdue", "Bucket", "Outstanding"]
      const lines = rows.map((r) =>
        [r.number, kind === "client" ? r.clientName : r.memberName, r.dueDate, r.daysOverdue, r.bucket, r.dueAmount.toFixed(2)]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-invoices-aging-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, kind, registerExportHandler])

  const { currency, mixed } = useCurrencySummary(rows)
  const buckets = useMemo(() => {
    const totals = new Map<string, number>()
    rows.forEach((r) => totals.set(r.bucket, (totals.get(r.bucket) ?? 0) + r.dueAmount))
    return BUCKET_ORDER.map((b) => ({ bucket: b, label: BUCKET_LABEL[b], amount: totals.get(b) ?? 0 }))
  }, [rows])

  const grouped = useMemo(
    () => groupReportRows(rows, (r) => keyForAgingGroup(r, groupBy)),
    [rows, groupBy]
  )

  useEffect(() => {
    const runPdfExport = () => {
      const partyLabel = kind === "client" ? "Client" : "Member"
      downloadReportPdf({
        title: `${kind === "client" ? "Client" : "Team"} Invoices Aging Report`,
        subtitle: asOf ? `Aged as of ${formatDay(asOf)}.` : undefined,
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        charts:
          !mixed && rows.length > 0
            ? [
                {
                  type: "bar",
                  title: "Outstanding by age bucket",
                  data: buckets.map((b) => ({ label: b.label, value: b.amount })),
                  valueFormatter: (v) => money(v, currency),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Number", key: "number" },
            { header: partyLabel, key: "party" },
            { header: "Due", key: "due" },
            { header: "Days overdue", key: "overdue", align: "right" },
            { header: "Bucket", key: "bucket" },
            { header: "Outstanding", key: "outstanding", align: "right" },
          ],
          rows: rows.map((r) => ({
            number: r.number,
            party: (kind === "client" ? r.clientName : r.memberName) || "—",
            due: formatDay(r.dueDate),
            overdue: String(r.daysOverdue),
            bucket: BUCKET_LABEL[r.bucket] ?? r.bucket,
            outstanding: money(r.dueAmount, r.currency),
          })),
          emptyMessage: "Nothing outstanding.",
        },
        filename: `${kind}-invoices-aging`,
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, kind, asOf, buckets, currency, mixed, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={3} rows={6} columns={5} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="Nothing outstanding"
        subtitle="Every issued invoice in scope has been settled."
      />
    )
  }

  return (
    <div className="space-y-5">
      {asOf ? (
        <p className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>Aged as of {formatDay(asOf)}.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {buckets.map((b) => (
          <div
            key={b.bucket}
            className={cn(
              "rounded-xl border px-4 py-3 shadow-sm",
              isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
            )}
          >
            <div className={cn("text-[10px] font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
              {b.label}
            </div>
            <div
              className={cn(
                "mt-1 text-base font-semibold tabular-nums",
                b.bucket === "90+" && b.amount > 0 ? "text-red-500" : isDark ? "text-[#dce1fb]" : "text-slate-800"
              )}
            >
              {mixed ? "—" : money(b.amount, currency)}
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
          <table className="w-full min-w-[740px] table-fixed">
            <thead>
              <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
                {[
                  ["Number", "w-[16%] text-left"],
                  [kind === "client" ? "Client" : "Member", "w-[24%] text-left"],
                  ["Due", "w-[16%] text-left"],
                  ["Days overdue", "w-[15%] text-right"],
                  ["Bucket", "w-[15%] text-center"],
                  ["Outstanding", "w-[14%] text-right"],
                ].map(([label, cls]) => (
                  <th key={label} className={cn(thBase, cls, isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <Fragment key={g.key}>
                  <tr className={cn(isDark ? "bg-white/10" : "bg-slate-100")}>
                    <td colSpan={6} className="px-4 py-2">
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
                          <td className={cn("px-4 py-3 text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                            {r.number}
                          </td>
                          <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {kind === "client" ? r.clientName || "—" : r.memberName || "—"}
                          </td>
                          <td className={cn("px-4 py-3 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {formatDay(r.dueDate)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right text-sm tabular-nums",
                              r.daysOverdue > 60 ? "text-red-500" : isDark ? "text-[#bccbb9]" : "text-slate-600"
                            )}
                          >
                            {r.daysOverdue}
                          </td>
                          <td className={cn("px-4 py-3 text-center text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                            {BUCKET_LABEL[r.bucket] ?? r.bucket}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-red-500">
                            {money(r.dueAmount, r.currency)}
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

// ─── Page wrappers ─────────────────────────────────────────────────────────

function InvoiceReportPage({
  kind,
  aging,
  title,
  exportFileBaseName,
  pageId,
  onNavigate,
}: {
  kind: InvoiceKind
  aging: boolean
  title: string
  exportFileBaseName: string
  pageId: string
  onNavigate?: (id: string) => void
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
      // Client invoices carry no member dimension (no project dimension
      // either way - invoice rows have no project_id at all).
      groupByOptions={kind === "team" ? TEAM_INVOICE_GROUP_BY_OPTIONS : CLIENT_INVOICE_GROUP_BY_OPTIONS}
      // Client invoices have no member dimension to filter on.
      filtersPanel={
        kind === "team"
          ? (close) => (
              <ReportFiltersPanel
                onClose={close}
                options={options}
                value={filters}
                onChange={setFilters}
                showProjects={false}
              />
            )
          : undefined
      }
    >
      {aging ? <AgingTable kind={kind} filters={filters} /> : <InvoicesTable kind={kind} filters={filters} />}
    </StandardReportLayout>
  )
}

export function ClientInvoicesReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <InvoiceReportPage kind="client" aging={false} title="Client invoices report" exportFileBaseName="client-invoices" pageId="reports-client-invoices" onNavigate={onNavigate} />
  )
}

export function TeamInvoicesReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <InvoiceReportPage kind="team" aging={false} title="Team invoices report" exportFileBaseName="team-invoices" pageId="reports-team-invoices" onNavigate={onNavigate} />
  )
}

export function ClientInvoicesAgingReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <InvoiceReportPage kind="client" aging title="Client invoices aging report" exportFileBaseName="client-invoices-aging" pageId="reports-client-invoices-aging" onNavigate={onNavigate} />
  )
}

export function TeamInvoicesAgingReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <InvoiceReportPage kind="team" aging title="Team invoices aging report" exportFileBaseName="team-invoices-aging" pageId="reports-team-invoices-aging" onNavigate={onNavigate} />
  )
}
