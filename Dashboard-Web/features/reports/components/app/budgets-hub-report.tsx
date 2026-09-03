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
import { budgetPercentUsed } from "@/features/reports/components/project-budgets/project-budgets-report"

interface Tile {
  id: string
  title: string
  description: string
  headline: string
  detail: string
  failed?: boolean
}

function BudgetsHubContent({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd } = useStandardReportLayout()
  const [tiles, setTiles] = useState<Tile[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)

    const failed = { project: false, client: false, weekly: false, daily: false }
    void Promise.all([
      fetchProjectBudgetsReport().catch(() => {
        failed.project = true
        return []
      }),
      fetchClientBudgetsReport().catch(() => {
        failed.client = true
        return []
      }),
      fetchWeeklyLimitsReport({ from, to }).catch(() => {
        failed.weekly = true
        return []
      }),
      fetchDailyLimitsReport({ from, to }).catch(() => {
        failed.daily = true
        return []
      }),
    ]).then(([projectSections, clientRows, weekly, daily]) => {
      if (cancelled) return

      const projectRows = projectSections.flatMap((s) => s.rows).filter((r) => r.budgetType !== null)
      const projectsOver = projectRows.filter((r) => budgetPercentUsed(r) >= 100).length
      const clientsOver = clientRows.filter((r) => r.pctUsed >= 100).length
      const weeklyOver = weekly.filter((r) => r.pctUsed >= 100).length
      const dailyOver = daily.filter((r) => r.pctUsed >= 100).length

      setTiles([
        {
          id: "reports-project-budgets",
          title: "Project budgets",
          description: "How much of each project budget has been spent.",
          headline: failed.project ? "Unavailable" : `${projectRows.length} with a budget`,
          detail: failed.project ? "This report could not be loaded." : projectsOver > 0 ? `${projectsOver} over budget` : "None over budget",
          failed: failed.project,
        },
        {
          id: "reports-client-budgets",
          title: "Client budgets",
          description: "How much of each client budget has been spent.",
          headline: failed.client ? "Unavailable" : `${clientRows.length} with a budget`,
          detail: failed.client ? "This report could not be loaded." : clientsOver > 0 ? `${clientsOver} over budget` : "None over budget",
          failed: failed.client,
        },
        {
          id: "reports-weekly-limits",
          title: "Weekly limits",
          description: "Weekly hour limits and how close people are to them.",
          headline: failed.weekly ? "Unavailable" : `${weekly.length} tracked`,
          detail: failed.weekly ? "This report could not be loaded." : weeklyOver > 0 ? `${weeklyOver} at or over limit` : "None over limit",
          failed: failed.weekly,
        },
        {
          id: "reports-daily-limits",
          title: "Daily limits",
          description: "Daily hour limits and how close people are to them.",
          headline: failed.daily ? "Unavailable" : `${daily.length} tracked`,
          detail: failed.daily ? "This report could not be loaded." : dailyOver > 0 ? `${dailyOver} at or over limit` : "None over limit",
          failed: failed.daily,
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
            <div
              className={cn(
                "text-lg font-semibold",
                t.failed ? "text-rose-600 dark:text-rose-400" : isDark ? "text-[#dce1fb]" : "text-slate-800"
              )}
            >
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
