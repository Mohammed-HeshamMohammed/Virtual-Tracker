"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ChevronDown, LayoutList } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchClientBudgetsReport } from "@/features/reports/api/misc-reports-api"
import type { ClientBudgetRow } from "@/features/reports/models/client-budgets"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  CLIENT_BUDGETS_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  CALENDAR_DATE_LABEL,
} from "@/features/reports/components/shared/constants"
import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
import { formatMoney, useWorkspaceCurrency } from "@/shared/utils/workspace-currency"

/** Caps and spend come back converted into the workspace's currency. */
function formatAmount(value: number, currency?: string): string {
  return formatMoney(value, currency)
}

function groupClientBudgetRows(
  rows: ClientBudgetRow[],
  groupBy: string
): { key: string; label: string; rows: ClientBudgetRow[] }[] {
  if (groupBy === "client") {
    return rows
      .slice()
      .sort((a, b) => a.clientName.localeCompare(b.clientName))
      .map((row) => ({ key: row.clientId, label: row.clientName, rows: [row] }))
  }
  const order: string[] = []
  const map = new Map<string, ClientBudgetRow[]>()
  for (const row of rows) {
    const key = row.hasBudget ? row.budgetType || "Budgeted (type not set)" : "No budget set"
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(row)
  }
  return order.map((key) => ({ key, label: key, rows: map.get(key) ?? [] }))
}

function ClientBudgetsTable() {
  const { isDark } = useTheme()
  const currency = useWorkspaceCurrency()
  const { groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [rows, setRows] = useState<ClientBudgetRow[]>([])
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
        [r.clientName, r.budgetType ?? "No budget", formatAmount(r.spentAmount), r.hasBudget ? formatAmount(r.cap) : "-", `${r.pctUsed}%`]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",")
      )
      const csv = [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `client-budgets-${todayDateParam()}.csv`
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
        timezoneLabel: CALENDAR_DATE_LABEL,
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
                      sublabel: `${formatAmount(r.spentAmount)} of ${formatAmount(r.cap)}`,
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
            spent: formatAmount(r.spentAmount),
            cap: r.hasBudget ? formatAmount(r.cap) : "—",
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

  const grouped = useMemo(() => groupClientBudgetRows(rows, groupBy), [rows, groupBy])

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
          {grouped.map((g) => (
            <Fragment key={g.key}>
              <tr>
                <td colSpan={3} className="px-4 py-0">
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(g.key)}
                    className={cn(
                      "flex w-full items-center gap-2 py-2 text-left text-xs font-semibold uppercase tracking-wide",
                      isDark ? "bg-white/6 text-white/50" : "bg-slate-100 text-slate-500"
                    )}
                  >
                    <LayoutList className="h-3.5 w-3.5 shrink-0" />
                    <span>{g.label}</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-3.5 w-3.5 transition-transform",
                        collapsedGroups.has(g.key) && "-rotate-90"
                      )}
                    />
                  </button>
                </td>
              </tr>
              {!collapsedGroups.has(g.key) &&
                g.rows.map((row) => (
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
                      {formatAmount(row.spentAmount)}
                    </td>
                    <td className="px-4 py-3.5">
                      {row.hasBudget ? (
                        <div className="space-y-2">
                          <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{formatAmount(row.cap)}</div>
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
            </Fragment>
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
      showDateRange={false}
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={CLIENT_BUDGETS_GROUP_BY_OPTIONS}
      defaultGroupBy="budgetType"
      // No ReportFiltersPanel here: ClientBudgetRow carries no member and no
      // project (each client can have several client_projects, but the row
      // has no project id/name to filter on, and the endpoint takes no query
      // params at all) - so there is nothing real to wire a filters panel
      // to. See groupClientBudgetRows above for the dimensions that do work.
    >
      <ClientBudgetsTable />
    </StandardReportLayout>
  )
}
