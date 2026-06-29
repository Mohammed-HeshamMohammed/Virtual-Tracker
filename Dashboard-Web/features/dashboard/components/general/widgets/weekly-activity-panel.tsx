"use client"

import { TrendingUp } from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"

export function WeeklyActivityPanel() {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const days = viewData?.weeklyActivity ?? []
  const chartPath = viewData?.chartPath ?? ""
  const chartFill = viewData?.chartFill ?? ""

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "short" }).toUpperCase().slice(0, 3)

  return (
    <PanelShell
      title="Weekly trends"
      subtitle="Active hours by day"
      icon={<TrendingUp className="h-5 w-5" />}
      iconClassName="bg-green-600"
      loading={loading}
      error={error}
      onRetry={retry}
      empty={!loading && days.every((d) => d.activeHours === 0 && d.idleHours === 0)}
      emptyMessage="No activity recorded this week."
      action={
        <div className="hidden items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            Active
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
            Idle
          </span>
        </div>
      }
    >
      <div className="relative min-h-0 flex-1 sm:min-h-[220px]">
        {chartPath ? (
          <svg className="h-full w-full" viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="generalWeeklyGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={chartFill} fill="url(#generalWeeklyGradient)" />
            <path d={chartPath} fill="none" stroke="#047857" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : null}
      </div>
      <div className="mt-4 flex justify-between px-1">
        {days.map((day) => (
          <span
            key={day.key}
            className={
              day.label === todayLabel
                ? "text-[11px] font-bold text-emerald-700 underline decoration-2 underline-offset-4"
                : "text-[11px] font-bold text-slate-400"
            }
          >
            {day.label}
          </span>
        ))}
      </div>
    </PanelShell>
  )
}
