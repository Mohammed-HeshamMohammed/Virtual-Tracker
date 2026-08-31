"use client"

import { useEffect, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchClientBudgetsReport } from "@/features/reports/api/misc-reports-api"
import type { ClientBudgetRow } from "@/features/reports/models/client-budgets"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, STANDARD_REPORT_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function ClientBudgetsTable() {
  const { isDark } = useTheme()
  const { registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<ClientBudgetRow[]>([])
  const [loading, setLoading] = useState(true)
  // A failed read used to be indistinguishable from an empty report:
  // getJson swallowed every error and the table rendered "no rows".
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientBudgetsReport()
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
  }, [reloadKey])

  useEffect(() => {
    const runExport = () => {
      const header = ["Client", "Budget type", "Spent", "Cap", "% used"]
      const lines = rows.map((r) =>
        [r.clientName, r.budgetType ?? "No budget", formatUsd(r.spentAmount), r.hasBudget ? formatUsd(r.cap) : "-", `${r.pctUsed}%`]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `client-budgets-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [rows, registerExportHandler])

  useEffect(() => {
    const runPdfExport = () => {
      const withBudget = rows.filter((r) => r.hasBudget && r.cap > 0)
      downloadReportPdf({
        title: "Client Budgets Report",
        subtitle: "How much of each client's budget has been spent.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
        charts:
          withBudget.length > 0
            ? [
                {
                  type: "progress",
                  title: "Budget used",
                  rows: withBudget
                    .slice()
                    .sort((a, b) => b.pctUsed - a.pctUsed)
                    .map((r) => ({
                      label: r.clientName,
                      pct: r.pctUsed,
                      sublabel: `${formatUsd(r.spentAmount)} of ${formatUsd(r.cap)}`,
                    })),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Client", key: "client" },
            { header: "Budget type", key: "type" },
            { header: "Spent", key: "spent", align: "right" },
            { header: "Cap", key: "cap", align: "right" },
            { header: "% used", key: "pct", align: "right" },
          ],
          rows: rows.map((r) => ({
            client: r.clientName,
            type: r.budgetType ?? "No budget",
            spent: formatUsd(r.spentAmount),
            cap: r.hasBudget ? formatUsd(r.cap) : "—",
            pct: r.hasBudget ? `${r.pctUsed}%` : "—",
          })),
          emptyMessage: "No clients found.",
        },
        filename: "client-budgets",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [rows, registerPdfExportHandler])

  if (loading) return <ReportTableSkeleton rows={6} columns={5} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Client</th>
            <th className={th}>Spent</th>
            <th className={cn(th, "min-w-48")}>Budget cap</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No clients found.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr
              key={row.clientId}
              className={cn("border-b last:border-b-0", isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80")}
            >
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", row.avatarClassName)}>
                    {row.initial}
                  </span>
                  <span className={cn("font-medium", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{row.clientName}</span>
                </div>
              </td>
              <td className={cn("px-4 py-3.5 tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                {formatUsd(row.spentAmount)}
              </td>
              <td className="px-4 py-3.5">
                {row.hasBudget ? (
                  <div className="space-y-2">
                    <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{formatUsd(row.cap)}</div>
                    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-white/10" : "bg-slate-200")}>
                      <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${Math.min(100, row.pctUsed)}%` }} />
                    </div>
                    <div className={cn("text-xs tabular-nums", isDark ? "text-white/45" : "text-slate-500")}>{row.pctUsed}%</div>
                  </div>
                ) : (
                  <span className={cn("text-sm", isDark ? "text-white/40" : "text-slate-400")}>No budget set</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ClientBudgetsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <StandardReportLayout
      title="Client budgets report"
      onNavigate={onNavigate}
      exportFileBaseName="client-budgets"
      pageId="reports-client-budgets"
      // Client budget usage derives its own period from the budget's reset
      // cadence (client-budget-usage.js), so an arbitrary date range has no
      // meaning here and the backend never accepted one.
      showDateRange={false}
      showScopeTabs={false}
      showGroupBy={false}
    >
      <ClientBudgetsTable />
    </StandardReportLayout>
  )
}
