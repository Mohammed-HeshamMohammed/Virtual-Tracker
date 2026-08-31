"use client"

import { useEffect, useMemo, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import {
  ReportEmptyState,
  StandardReportLayout,
  useStandardReportLayout,
} from "@/features/reports/components/app/standard-report-layout"
import {
  fetchTimeOffBalancesReport,
  fetchTimeOffTransactionsReport,
  type TimeOffBalanceRow,
  type TimeOffTransactionRow,
} from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"
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

/** Days render as whole numbers when whole, one decimal otherwise. */
function days(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const thBase = "px-4 py-3 text-sm font-semibold"

// ─── Balances ──────────────────────────────────────────────────────────────

function BalancesTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeEnd, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<TimeOffBalanceRow[]>([])
  const [asOf, setAsOf] = useState("")
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
    const to = rangeEnd.toISOString().slice(0, 10)
    fetchTimeOffBalancesReport({ from: to, to, memberIds: [...filters.memberIds] })
      .then((data) => {
        if (cancelled) return
        setRows(data.rows)
        setAsOf(data.asOf)
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
  }, [rangeEnd, filters, reloadKey])

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Member", "Policy", "Entitlement (days)", "Accrued", "Used", "Balance"]
      const lines = rows.map((r) =>
        [r.memberName, r.policyName, r.entitlementDays, r.accruedDays, r.usedDays, r.balanceDays]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `time-off-balances-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  useEffect(() => {
    const runPdfExport = () => {
      downloadReportPdf({
        title: "Time Off Balances Report",
        subtitle: asOf ? `Balances as of ${formatDay(asOf)}.` : undefined,
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        charts:
          rows.length > 0
            ? [
                {
                  type: "bar",
                  title: "Balance by member",
                  data: rows
                    .slice()
                    .sort((a, b) => b.balanceDays - a.balanceDays)
                    .map((r) => ({ label: r.memberName, value: r.balanceDays })),
                  valueFormatter: (v) => days(v),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Member", key: "member" },
            { header: "Policy", key: "policy" },
            { header: "Entitlement", key: "entitlement", align: "right" },
            { header: "Accrued", key: "accrued", align: "right" },
            { header: "Used", key: "used", align: "right" },
            { header: "Balance", key: "balance", align: "right" },
          ],
          rows: rows.map((r) => ({
            member: r.memberName,
            policy: r.policyName,
            entitlement: days(r.entitlementDays),
            accrued: days(r.accruedDays),
            used: days(r.usedDays),
            balance: days(r.balanceDays),
          })),
          emptyMessage: "No time off balances.",
        },
        filename: "time-off-balances",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, asOf, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={3} rows={6} columns={5} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No time off balances"
        subtitle="Balances appear once a time off policy exists and days have been accrued or taken."
      />
    )
  }

  return (
    <div className="space-y-3">
      {asOf ? (
        <p className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>
          Balances as of {formatDay(asOf)}.
        </p>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-xl border shadow-sm",
          isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-100 bg-white"
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed">
            <thead>
              <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
                {[
                  ["Member", "w-[26%] text-left"],
                  ["Policy", "w-[22%] text-left"],
                  ["Entitlement", "w-[13%] text-right"],
                  ["Accrued", "w-[13%] text-right"],
                  ["Used", "w-[13%] text-right"],
                  ["Balance", "w-[13%] text-right"],
                ].map(([label, cls]) => (
                  <th key={label} className={cn(thBase, cls, isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.memberId}-${r.policyId}`}
                  className={cn(
                  "border-b transition-colors",
                  isDark ? "border-white/5 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ReportMemberAvatar initials={initialsFor(r.memberName)} />
                      <span className={cn("truncate text-sm", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                        {r.memberName}
                      </span>
                    </div>
                  </td>
                  <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                    {r.policyName}
                  </td>
                  <td className={cn("px-4 py-3 text-right text-sm tabular-nums", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                    {days(r.entitlementDays)}
                  </td>
                  <td className={cn("px-4 py-3 text-right text-sm tabular-nums", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                    {days(r.accruedDays)}
                  </td>
                  <td className={cn("px-4 py-3 text-right text-sm tabular-nums", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                    {days(r.usedDays)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right text-sm font-semibold tabular-nums",
                      r.balanceDays < 0 ? "text-red-500" : isDark ? "text-[#dce1fb]" : "text-slate-900"
                    )}
                  >
                    {days(r.balanceDays)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function TimeOffBalancesReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Time off balances report"
      onNavigate={onNavigate}
      exportFileBaseName="time-off-balances"
      pageId="reports-time-off-balances"
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
      <BalancesTable filters={filters} />
    </StandardReportLayout>
  )
}

// ─── Transactions ──────────────────────────────────────────────────────────

const KIND_STYLE: Record<string, string> = {
  accrual: "bg-emerald-50 text-emerald-600",
  usage: "bg-blue-50 text-blue-600",
  adjustment: "bg-amber-50 text-amber-600",
}

function TransactionsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<TimeOffTransactionRow[]>([])
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
    fetchTimeOffTransactionsReport({
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

  useEffect(() => {
    registerExportHandler(() => {
      const header = ["Date", "Member", "Policy", "Type", "Days", "Note"]
      const lines = rows.map((r) =>
        [r.effectiveOn, r.memberName, r.policyName, r.kind, r.days, r.note]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `time-off-transactions-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  const net = useMemo(() => rows.reduce((s, r) => s + r.days, 0), [rows])

  useEffect(() => {
    const runPdfExport = () => {
      const byKind = new Map<string, number>()
      rows.forEach((r) => byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + Math.abs(r.days)))
      downloadReportPdf({
        title: "Time Off Transactions Report",
        subtitle: "Accruals, approved leave, and manual adjustments.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        summary: [{ label: "Net change", value: net > 0 ? `+${days(net)}` : days(net) }],
        charts:
          byKind.size > 0
            ? [
                {
                  type: "bar",
                  title: "Days by transaction type",
                  data: [...byKind.entries()].map(([label, value]) => ({
                    label: label.charAt(0).toUpperCase() + label.slice(1),
                    value,
                  })),
                  valueFormatter: (v) => days(v),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Date", key: "date" },
            { header: "Member", key: "member" },
            { header: "Policy", key: "policy" },
            { header: "Type", key: "type" },
            { header: "Days", key: "days", align: "right" },
            { header: "Note", key: "note" },
          ],
          rows: rows.map((r) => ({
            date: formatDay(r.effectiveOn),
            member: r.memberName,
            policy: r.policyName,
            type: r.kind,
            days: r.days > 0 ? `+${days(r.days)}` : days(r.days),
            note: r.note || "—",
          })),
          emptyMessage: "No time off activity in this range.",
        },
        filename: "time-off-transactions",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, net, dateLabel, registerPdfExportHandler])

  if (loading) {
    return <ReportSkeleton tiles={3} rows={6} columns={5} />
  }
  if (error) {
    return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        title="No time off activity in this range"
        subtitle="Accruals, approved leave and manual adjustments all appear here."
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
        <table className="w-full min-w-[760px] table-fixed">
          <thead>
            <tr className={cn("border-b", isDark ? "border-white/10" : "border-slate-100")}>
              {[
                ["Date", "w-[15%] text-left"],
                ["Member", "w-[24%] text-left"],
                ["Policy", "w-[18%] text-left"],
                ["Type", "w-[13%] text-center"],
                ["Days", "w-[10%] text-right"],
                ["Note", "w-[20%] text-left"],
              ].map(([label, cls]) => (
                <th key={label} className={cn(thBase, cls, isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn(
                  "border-b transition-colors",
                  isDark ? "border-white/5 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                )}>
                <td className={cn("px-4 py-3 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                  {formatDay(r.effectiveOn)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ReportMemberAvatar initials={initialsFor(r.memberName)} />
                    <span className={cn("truncate text-sm", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                      {r.memberName}
                    </span>
                  </div>
                </td>
                <td className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                  {r.policyName}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                      KIND_STYLE[r.kind] ?? "bg-slate-100 text-slate-600"
                    )}
                  >
                    {r.kind}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right text-sm font-semibold tabular-nums",
                    r.days < 0 ? "text-red-500" : "text-emerald-600"
                  )}
                >
                  {r.days > 0 ? `+${days(r.days)}` : days(r.days)}
                </td>
                <td
                  className={cn("truncate px-4 py-3 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}
                  title={r.note}
                >
                  {r.note || "—"}
                </td>
              </tr>
            ))}
            <tr className={cn("border-t-2 font-semibold", isDark ? "border-white/10" : "border-slate-200")}>
              <td colSpan={4} className={cn("px-4 py-3 text-sm", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Net change
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right text-sm tabular-nums",
                  net < 0 ? "text-red-500" : "text-emerald-600"
                )}
              >
                {net > 0 ? `+${days(net)}` : days(net)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TimeOffTransactionsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Time off transactions report"
      onNavigate={onNavigate}
      exportFileBaseName="time-off-transactions"
      pageId="reports-time-off-transactions"
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
      <TransactionsTable filters={filters} />
    </StandardReportLayout>
  )
}
