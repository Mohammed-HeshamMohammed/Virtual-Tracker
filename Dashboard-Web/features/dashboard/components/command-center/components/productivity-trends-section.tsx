"use client"

import { useEffect, useMemo, useState } from "react"
import { Activity, Clock3, MoonStar } from "lucide-react"
import type { ProjectData, WeeklyTrendDay } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface ProductivityTrendsSectionProps {
  project: ProjectData
}

const CHART_WIDTH = 800
const CHART_TOP = 8
const CHART_BOTTOM = 172

function linePath(values: number[], max: number): string {
  if (values.length === 0) return ""
  return values
    .map((value, index) => {
      const x = values.length === 1 ? CHART_WIDTH / 2 : (index / (values.length - 1)) * CHART_WIDTH
      const y = CHART_BOTTOM - (value / max) * (CHART_BOTTOM - CHART_TOP)
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function areaBetween(upper: number[], lower: number[], max: number): string {
  if (upper.length === 0 || upper.length !== lower.length) return ""
  const point = (value: number, index: number) => {
    const x = upper.length === 1 ? CHART_WIDTH / 2 : (index / (upper.length - 1)) * CHART_WIDTH
    const y = CHART_BOTTOM - (value / max) * (CHART_BOTTOM - CHART_TOP)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }
  const upperPoints = upper.map((value, index) => point(value, index))
  const lowerPoints = lower.map((value, index) => point(value, index)).reverse()
  return `M${upperPoints.join(" L")} L${lowerPoints.join(" L")} Z`
}

function pointFor(values: number[], index: number, max: number): { x: number; y: number } | null {
  if (index < 0 || index >= values.length) return null
  return {
    x: values.length === 1 ? CHART_WIDTH / 2 : (index / (values.length - 1)) * CHART_WIDTH,
    y: CHART_BOTTOM - (values[index]! / max) * (CHART_BOTTOM - CHART_TOP),
  }
}

function formatHours(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`
}

function activityRate(day: WeeklyTrendDay | undefined): number {
  if (!day) return 0
  const total = day.activeSeconds + day.idleSeconds
  return total > 0 ? Math.round((day.activeSeconds / total) * 100) : 0
}

export function ProductivityTrendsSection({ project }: ProductivityTrendsSectionProps) {
  const todayKey = useMemo(() => {
    const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
    const jsDay = new Date().getDay()
    return keys[jsDay === 0 ? 6 : jsDay - 1]
  }, [])

  const defaultDay =
    project.weeklyTrend.find((day) => day.key === todayKey)?.key ??
    project.weeklyTrend.find((day) => day.active + day.idle > 0)?.key ??
    project.weeklyTrend[0]?.key ??
    "mon"
  const [selectedDayKey, setSelectedDayKey] = useState(defaultDay)

  useEffect(() => setSelectedDayKey(defaultDay), [project.id, defaultDay])

  const selectedDay = project.weeklyTrend.find((day) => day.key === selectedDayKey) ?? project.weeklyTrend[0]
  const selectedIndex = project.weeklyTrend.findIndex((day) => day.key === selectedDayKey)
  const activeValues = project.weeklyTrend.map((day) => day.active)
  const totalValues = project.weeklyTrend.map((day) => day.active + day.idle)
  const rawMax = Math.max(...totalValues, 0)
  const step = rawMax <= 4 ? 1 : rawMax <= 12 ? 2 : rawMax <= 24 ? 4 : 8
  const chartMax = Math.max(step, Math.ceil(rawMax / step) * step)
  const activePath = linePath(activeValues, chartMax)
  const totalPath = linePath(totalValues, chartMax)
  const activeArea = activePath ? `${activePath} L${CHART_WIDTH},${CHART_BOTTOM} L0,${CHART_BOTTOM} Z` : ""
  const idleArea = areaBetween(totalValues, activeValues, chartMax)
  const activePoint = pointFor(activeValues, selectedIndex, chartMax)
  const totalPoint = pointFor(totalValues, selectedIndex, chartMax)
  const hasData = rawMax > 0
  const selectedTotal = (selectedDay?.active ?? 0) + (selectedDay?.idle ?? 0)
  const gradientId = `cc-active-${project.id.replace(/[^a-zA-Z0-9_-]/g, "")}`
  const idleGradientId = `cc-idle-${project.id.replace(/[^a-zA-Z0-9_-]/g, "")}`

  return (
    <SectionCard
      help="Weekly productivity trends: active and idle hours by day. Select a day to inspect its tracked total and activity rate."
      className="lg:col-span-2"
    >
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Weekly Productivity Trends</h3>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {project.name} · active and idle time for the current week
          </p>
        </div>
        <div className="flex items-center gap-4" aria-label="Chart legend">
          {[
            { color: "bg-emerald-500 dark:bg-emerald-400", label: "Active" },
            { color: "bg-slate-400 dark:bg-slate-500", label: "Idle" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        {[
          { icon: Clock3, label: "Tracked", value: formatHours(selectedTotal) },
          { icon: Activity, label: "Active", value: formatHours(selectedDay?.active ?? 0) },
          { icon: MoonStar, label: "Activity rate", value: `${activityRate(selectedDay)}%` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/45">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm dark:bg-slate-800 dark:text-emerald-400">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</span>
              <span className="block text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="relative rounded-2xl border border-slate-100 bg-slate-50/45 px-4 pb-3 pt-4 dark:border-slate-800 dark:bg-slate-950/20">
        <div className="flex h-48 gap-3">
          <div className="relative w-9 shrink-0 text-[10px] font-semibold tabular-nums text-slate-400 dark:text-slate-600" aria-hidden>
            {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
              <span key={ratio} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - ratio) * 91 + 4}%` }}>
                {formatHours(chartMax * ratio)}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${CHART_WIDTH} 180`} preserveAspectRatio="none" role="img" aria-label="Active and idle hours by day">
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id={idleGradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#64748b" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#64748b" stopOpacity="0.06" />
                </linearGradient>
              </defs>
              {[CHART_TOP, 49, 90, 131, CHART_BOTTOM].map((y) => (
                <line key={y} x1="0" x2={CHART_WIDTH} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-800" strokeDasharray="4 6" />
              ))}
              {hasData ? (
                <>
                  <path d={activeArea} fill={`url(#${gradientId})`} />
                  <path d={idleArea} fill={`url(#${idleGradientId})`} />
                  <path d={totalPath} fill="none" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={activePath} fill="none" stroke="#10b981" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                  {activePoint && totalPoint ? (
                    <>
                      <line x1={activePoint.x} x2={activePoint.x} y1={CHART_TOP} y2={CHART_BOTTOM} className="stroke-emerald-500/30" strokeDasharray="4 5" />
                      <circle cx={totalPoint.x} cy={totalPoint.y} r="5" className="fill-slate-400 stroke-white dark:stroke-slate-950" strokeWidth="2" />
                      <circle cx={activePoint.x} cy={activePoint.y} r="6" fill="#10b981" className="stroke-white dark:stroke-slate-950" strokeWidth="2" />
                    </>
                  ) : null}
                </>
              ) : (
                <text x={CHART_WIDTH / 2} y="92" textAnchor="middle" className="fill-slate-400 text-[13px] font-semibold dark:fill-slate-500">
                  No tracked time yet this week
                </text>
              )}
            </svg>
          </div>
        </div>

        <div className="ml-12 grid grid-cols-7 gap-1 pt-1">
          {project.weeklyTrend.map((day) => {
            const selected = day.key === selectedDayKey
            const hasHours = day.active + day.idle > 0
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelectedDayKey(day.key)}
                aria-pressed={selected}
                className={
                  selected
                    ? "rounded-lg bg-emerald-50 px-1 py-1.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
                    : "rounded-lg px-1 py-1.5 text-[11px] font-bold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                }
              >
                <span className="block">{day.label}</span>
                <span className={`mt-0.5 block text-[9px] font-semibold tabular-nums ${hasHours ? "opacity-80" : "opacity-40"}`}>
                  {formatHours(day.active + day.idle)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </SectionCard>
  )
}
