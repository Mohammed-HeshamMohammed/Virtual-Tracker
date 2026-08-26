"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { PROJECT_BUDGETS_GROUP_BY_OPTIONS } from "@/features/reports/components/shared/constants"
import { formatDurationHms } from "@/features/reports/utils/format-duration-hms"
import type { ProjectBudgetRow, ProjectBudgetSection } from "@/features/reports/models/project-budgets"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchProjectBudgetsReport } from "@/features/reports/api/misc-reports-api"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"

function exportProjectBudgetsCsv(rows: { section: string; row: ProjectBudgetRow }[], dateLabel: string): void {
  const header = ["Section", "Project", "Spent (H:MM:SS)", "Budget (H:MM:SS)", "Remaining (H:MM:SS)", "% used"]
  const lines = rows.map(({ section, row }) => {
    const remaining = Math.max(0, row.budgetSeconds - row.spentSeconds)
    const pct =
      row.budgetSeconds > 0 ? Math.min(100, Math.round((row.spentSeconds / row.budgetSeconds) * 100)) : 0
    return [
      section,
      row.projectName,
      formatDurationHms(row.spentSeconds),
      formatDurationHms(row.budgetSeconds),
      formatDurationHms(remaining),
      String(pct),
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(",")
  })
  const csv = [header.join(","), ...lines, `"Range","${dateLabel.replace(/"/g, '""')}"`].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `project-budgets-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ProjectBudgetsTable() {
  const { isDark } = useTheme()
  const { dateLabel, registerExportHandler } = useStandardReportLayout()
  const [sections, setSections] = useState<ProjectBudgetSection[]>([])
  const [loading, setLoading] = useState(true)
  // A failed read used to be indistinguishable from an empty report:
  // getJson swallowed every error and the table rendered "no rows".
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchProjectBudgetsReport()
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
  }, [reloadKey])

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
          {sections.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No projects found.
              </td>
            </tr>
          ) : null}
          {sections.map((section) => (
            <Fragment key={section.label}>
              <tr>
                <td
                  colSpan={4}
                  className={cn(
                    "px-4 py-2 text-xs font-semibold uppercase tracking-wide",
                    isDark ? "bg-white/6 text-white/50" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {section.label}
                </td>
              </tr>
              {section.rows.map((row) => {
                const remaining = Math.max(0, row.budgetSeconds - row.spentSeconds)
                const percentUsed =
                  row.budgetSeconds > 0
                    ? Math.min(100, Math.round((row.spentSeconds / row.budgetSeconds) * 100))
                    : 0
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
                      {formatDurationHms(row.spentSeconds)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-2">
                        <div className={cn("tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                          {formatDurationHms(row.budgetSeconds)}
                        </div>
                        <div className={cn("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-white/10" : "bg-slate-200")}>
                          <div
                            className="h-full rounded-full bg-blue-500 transition-[width]"
                            style={{ width: `${percentUsed}%` }}
                          />
                        </div>
                        <div className={cn("text-xs tabular-nums", isDark ? "text-white/45" : "text-slate-500")}>
                          {percentUsed}%
                        </div>
                      </div>
                    </td>
                    <td className={cn("px-4 py-3.5 tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                      {formatDurationHms(remaining)}
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
  return (
    <StandardReportLayout
      title="Project budgets report"
      onNavigate={onNavigate}
      exportFileBaseName="project-budgets"
      pageId="reports-project-budgets"
      groupByOptions={PROJECT_BUDGETS_GROUP_BY_OPTIONS}
      defaultGroupBy="month"
      // Budget figures are scoped to the budget's own period (and its reset
      // cadence), not an arbitrary picked range - the backend has no from/to
      // for them. Hidden rather than left as controls that change nothing.
      showDateRange={false}
      showScopeTabs={false}
      showGroupBy={false}
    >
      <ProjectBudgetsTable />
    </StandardReportLayout>
  )
}

