"use client"

import { ChevronDown, LayoutList } from "lucide-react"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { PROJECT_BUDGETS_GROUP_BY_OPTIONS } from "@/features/reports/components/shared/constants"
import { formatDurationHms } from "@/features/reports/utils/format-duration-hms"
import { formatMoney } from "@/features/reports/utils/money"
import type { ProjectBudgetRow, ProjectBudgetSection } from "@/features/reports/models/project-budgets"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchProjectBudgetsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, CALENDAR_DATE_LABEL } from "@/features/reports/components/shared/constants"

import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
function budgetSpentDisplay(row: ProjectBudgetRow): string {
  return row.budgetType === "cost" ? formatMoney(row.spentAmount) : formatDurationHms(row.spentSeconds)
}
function budgetCapDisplay(row: ProjectBudgetRow): string {
  if (row.budgetType === "cost") return formatMoney(row.budgetAmount)
  if (row.budgetType === "hours") return formatDurationHms(row.budgetSeconds)
  return "No budget"
}
function budgetRemainingDisplay(row: ProjectBudgetRow): string {
  if (row.budgetType === "cost") return formatMoney(Math.max(0, row.budgetAmount - row.spentAmount))
  if (row.budgetType === "hours") return formatDurationHms(Math.max(0, row.budgetSeconds - row.spentSeconds))
  return "—"
}
export function budgetPercentUsed(row: ProjectBudgetRow): number {
  if (row.budgetType === "cost") {
    return row.budgetAmount > 0 ? Math.min(100, Math.round((row.spentAmount / row.budgetAmount) * 100)) : 0
  }
  if (row.budgetType === "hours") {
    return row.budgetSeconds > 0 ? Math.min(100, Math.round((row.spentSeconds / row.budgetSeconds) * 100)) : 0
  }
  return 0
}

function groupProjectBudgetRows(
  flatRows: { section: string; row: ProjectBudgetRow }[],
  groupBy: string
): { key: string; label: string; rows: ProjectBudgetRow[] }[] {
  if (groupBy === "project") {
    return flatRows
      .slice()
      .sort((a, b) => a.row.projectName.localeCompare(b.row.projectName))
      .map(({ row }) => ({ key: row.projectName, label: row.projectName, rows: [row] }))
  }
  const order: string[] = []
  const map = new Map<string, ProjectBudgetRow[]>()
  for (const { section, row } of flatRows) {
    if (!map.has(section)) {
      map.set(section, [])
      order.push(section)
    }
    map.get(section)!.push(row)
  }
  return order.map((key) => ({ key, label: key, rows: map.get(key) ?? [] }))
}

function exportProjectBudgetsCsv(rows: { section: string; row: ProjectBudgetRow }[], dateLabel: string): void {
  const header = ["Section", "Project", "Budget type", "Spent", "Budget", "Remaining", "% used"]
  const lines = rows.map(({ section, row }) => {
    return [
      section,
      row.projectName,
      row.budgetType === "cost" ? "Cost" : row.budgetType === "hours" ? "Hours" : "None",
      budgetSpentDisplay(row),
      budgetCapDisplay(row),
      budgetRemainingDisplay(row),
      String(budgetPercentUsed(row)),
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(",")
  })
  const csv = [header.join(","), ...lines, `"Range","${dateLabel.replace(/"/g, '""')}"`].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `project-budgets-${todayDateParam()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ProjectBudgetsTable({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { dateLabel, groupBy, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [sections, setSections] = useState<ProjectBudgetSection[]>([])
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
    fetchProjectBudgetsReport({ projectIds: [...filters.projectIds] })
      .then((data) => {
        if (!cancelled) setSections(data)
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
  }, [reloadKey, filters])

  const flatRows = useMemo(() => {
    const out: { section: string; row: ProjectBudgetRow }[] = []
    for (const sec of sections) {
      for (const row of sec.rows) {
        out.push({ section: sec.label, row })
      }
    }
    return out
  }, [sections])

  const runExport = useCallback(() => {
    exportProjectBudgetsCsv(flatRows, dateLabel)
  }, [flatRows, dateLabel])

  useEffect(() => {
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [registerExportHandler, runExport])

  useEffect(() => {
    const runPdfExport = () => {
      const withBudget = flatRows.filter(({ row }) => row.budgetType !== null)
      downloadReportPdf({
        title: "Project Budgets Report",
        subtitle: "How much of each project's budget has been spent.",
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
                    .sort((a, b) => budgetPercentUsed(b.row) - budgetPercentUsed(a.row))
                    .map(({ row }) => ({
                      label: row.projectName,
                      pct: budgetPercentUsed(row),
                      sublabel: `${budgetSpentDisplay(row)} of ${budgetCapDisplay(row)}`,
                    })),
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Section", key: "section" },
            { header: "Project", key: "project" },
            { header: "Spent", key: "spent", align: "right" },
            { header: "Budget", key: "budget", align: "right" },
            { header: "Remaining", key: "remaining", align: "right" },
            { header: "% used", key: "pct", align: "right" },
          ],
          rows: flatRows.map(({ section, row }) => ({
            section,
            project: row.projectName,
            spent: budgetSpentDisplay(row),
            budget: budgetCapDisplay(row),
            remaining: budgetRemainingDisplay(row),
            pct: row.budgetType !== null ? `${budgetPercentUsed(row)}%` : "—",
          })),
          emptyMessage: "No projects found.",
        },
        filename: "project-budgets",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [flatRows, registerPdfExportHandler])

  const grouped = useMemo(() => groupProjectBudgetRows(flatRows, groupBy), [flatRows, groupBy])

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  if (loading) return <ReportTableSkeleton rows={6} columns={5} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        isDark ? "border-white/10" : "border-slate-200"
      )}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Project</th>
            <th className={th}>Spent</th>
            <th className={cn(th, "min-w-48")}>Budget</th>
            <th className={th}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No projects found.
              </td>
            </tr>
          ) : null}
          {grouped.map((g) => (
            <Fragment key={g.key}>
              <tr>
                <td colSpan={4} className="px-4 py-0">
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
              {!collapsedGroups.has(g.key) && g.rows.map((row) => {
                const percentUsed = budgetPercentUsed(row)
                return (
                  <tr
                    key={row.projectName}
                    className={cn(
                      "border-b last:border-b-0",
                      isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                    )}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                            row.avatarClassName
                          )}
                        >
                          {row.initial}
                        </span>
                        <span className={cn("font-medium", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                          {row.projectName}
                        </span>
                      </div>
                    </td>
                    <td className={cn("px-4 py-3.5 tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                      {budgetSpentDisplay(row)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-2">
                        <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                          {budgetCapDisplay(row)}
                        </div>
                        {row.budgetType !== null ? (
                          <>
                            <div className={cn("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-white/10" : "bg-slate-200")}>
                              <div
                                className="h-full rounded-full bg-blue-500 transition-[width]"
                                style={{ width: `${percentUsed}%` }}
                              />
                            </div>
                            <div className={cn("text-xs tabular-nums", isDark ? "text-white/45" : "text-slate-500")}>
                              {percentUsed}%
                            </div>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td className={cn("px-4 py-3.5 tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                      {budgetRemainingDisplay(row)}
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ProjectBudgetsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Project budgets report"
      onNavigate={onNavigate}
      exportFileBaseName="project-budgets"
      pageId="reports-project-budgets"
      groupByOptions={PROJECT_BUDGETS_GROUP_BY_OPTIONS}
      defaultGroupBy="month"
      showDateRange={false}
      showScopeTabs={false}
      showGroupBy={true}
      filtersPanel={(close) => (
        <ReportFiltersPanel
          onClose={close}
          options={options}
          value={filters}
          onChange={setFilters}
          showProjects={true}
        />
      )}
    >
      <ProjectBudgetsTable filters={filters} />
    </StandardReportLayout>
  )
}

