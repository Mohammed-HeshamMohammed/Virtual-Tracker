"use client"

import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app/standard-report-layout"
import {
  fetchClientBudgetsReport,
  fetchProjectBudgetsReport,
  fetchWeeklyLimitsReport,
  fetchDailyLimitsReport,
} from "@/features/reports/api/misc-reports-api"
import { ReportCard } from "@/features/reports/components/shared/report-ui"

interface Tile {
  id: string
  title: string
  description: string
  headline: string
  detail: string
}

/**
 * Budgets and limits at a glance, with a way through to each detailed report.
 *
 * Every number here comes from the same endpoints the four linked reports use,
 * so the summary and the detail can never disagree.
 */
function BudgetsHubContent({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd } = useStandardReportLayout()
  const [tiles, setTiles] = useState<Tile[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)

    void Promise.all([
      fetchProjectBudgetsReport().catch(() => []),
      fetchClientBudgetsReport().catch(() => []),
      fetchWeeklyLimitsReport({ from, to }).catch(() => []),
      fetchDailyLimitsReport({ from, to }).catch(() => []),
    ]).then(([projectSections, clientRows, weekly, daily]) => {
      if (cancelled) return

      // ProjectBudgetRow carries seconds rather than a percentage, so derive
      // "over budget" the same way the project budgets report renders it.
      const projectRows = projectSections.flatMap((s) => s.rows).filter((r) => r.budgetSeconds > 0)
      const projectsOver = projectRows.filter((r) => r.spentSeconds >= r.budgetSeconds).length
      const clientsOver = clientRows.filter((r) => r.pctUsed >= 100).length
      const weeklyOver = weekly.filter((r) => r.pctUsed >= 100).length
      const dailyOver = daily.filter((r) => r.pctUsed >= 100).length

      setTiles([
        {
          id: "reports-project-budgets",
          title: "Project budgets",
          description: "How much of each project budget has been spent.",
          headline: `${projectRows.length} with a budget`,
          detail: projectsOver > 0 ? `${projectsOver} over budget` : "None over budget",
        },
        {
          id: "reports-client-budgets",
          title: "Client budgets",
          description: "How much of each client budget has been spent.",
          headline: `${clientRows.length} with a budget`,
          detail: clientsOver > 0 ? `${clientsOver} over budget` : "None over budget",
        },
        {
          id: "reports-weekly-limits",
          title: "Weekly limits",
          description: "Weekly hour limits and how close people are to them.",
          headline: `${weekly.length} tracked`,
          detail: weeklyOver > 0 ? `${weeklyOver} at or over limit` : "None over limit",
        },
        {
          id: "reports-daily-limits",
          title: "Daily limits",
          description: "Daily hour limits and how close people are to them.",
          headline: `${daily.length} tracked`,
          detail: dailyOver > 0 ? `${dailyOver} at or over limit` : "None over limit",
        },
      ])
    })

    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd])

  if (tiles === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <ReportCard key={i} className="p-5">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200/80 dark:bg-white/10" />
            <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100 dark:bg-white/5" />
            <div className="mt-5 h-5 w-24 animate-pulse rounded bg-slate-100 dark:bg-white/5" />
          </ReportCard>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onNavigate?.(t.id)}
          className={cn(
            "group flex flex-col items-start rounded-xl border p-5 text-left shadow-sm transition-colors",
            isDark ? "border-white/10 bg-[#151b2d] hover:bg-white/5" : "border-slate-100 bg-white hover:bg-slate-50"
          )}
        >
          <div className="flex w-full items-start justify-between gap-3">
            <h3 className={cn("text-base font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{t.title}</h3>
            <ArrowRight
              className={cn(
                "h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5",
                isDark ? "text-white/40" : "text-slate-400"
              )}
            />
          </div>
          <p className={cn("mt-1 text-sm", isDark ? "text-white/45" : "text-slate-500")}>{t.description}</p>
          <div className="mt-4">
            <div className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
              {t.headline}
            </div>
            <div className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>{t.detail}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

export function BudgetsHubReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <StandardReportLayout
      title="Budgets and limits report"
      onNavigate={onNavigate}
      exportFileBaseName="budgets-limits"
      subtitle="Every budget and limit report in one place, with where each one currently stands."
      showScopeTabs={false}
      showGroupBy={false}
    >
      <BudgetsHubContent onNavigate={onNavigate} />
    </StandardReportLayout>
  )
}
