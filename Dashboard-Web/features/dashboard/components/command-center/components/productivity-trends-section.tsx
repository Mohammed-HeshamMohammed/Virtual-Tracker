"use client"

import { useEffect, useMemo, useState } from "react"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface ProductivityTrendsSectionProps {
  project: ProjectData
}

export function ProductivityTrendsSection({ project }: ProductivityTrendsSectionProps) {
  const todayKey = useMemo(() => {
    const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
    const jsDay = new Date().getDay()
    const index = jsDay === 0 ? 6 : jsDay - 1
    return keys[index]
  }, [])

  const defaultDay =
    project.weeklyTrend.find((day) => day.key === todayKey)?.key ??
    project.weeklyTrend.find((day) => day.active > 0)?.key ??
    project.weeklyTrend[0]?.key ??
    "mon"

  const [selectedDayKey, setSelectedDayKey] = useState(defaultDay)

  useEffect(() => {
    setSelectedDayKey(defaultDay)
  }, [project.id, defaultDay])

  const selectedDay = project.weeklyTrend.find((day) => day.key === selectedDayKey) ?? project.weeklyTrend[0]
  const activePointIndex = project.weeklyTrend.findIndex((day) => day.key === selectedDayKey)

  const highlightPoint = useMemo(() => {
    if (activePointIndex < 0) return null
    const width = 800
    const height = 200
    const values = project.weeklyTrend.map((day) => day.active)
    const max = Math.max(...values, 1)
    const x = values.length <= 1 ? width / 2 : (activePointIndex / (values.length - 1)) * width
    const y = height - 24 - (values[activePointIndex] / max) * (height - 48)
    return { x, y }
  }, [activePointIndex, project.weeklyTrend])

  return (
    <SectionCard className="lg:col-span-2">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Weekly Productivity Trends</h3>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Task activity for {project.name} · {selectedDay?.label ?? "—"}
          </p>
        </div>
        <div className="flex gap-4">
          {[{ color: "bg-emerald-500 dark:bg-emerald-400", label: "Active" }, { color: "bg-slate-200 dark:bg-slate-700", label: "Idle" }].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative h-64 w-full">
        <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`ccGrad-${project.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={project.chartFill} fill={`url(#ccGrad-${project.id})`} />
          <path d={project.chartPath} fill="none" stroke="#10b981" strokeWidth="4" strokeLinecap="round" />
          {highlightPoint && (
            <circle
              cx={highlightPoint.x}
              cy={highlightPoint.y}
              r="6"
              fill="#10b981"
              stroke="#fff"
              strokeWidth="2"
            />
          )}
        </svg>
      </div>

      <div className="flex justify-between mt-6 px-2">
        {project.weeklyTrend.map((day) => {
          const selected = day.key === selectedDayKey
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => setSelectedDayKey(day.key)}
              className={
                selected
                  ? "text-xs font-bold text-emerald-600 dark:text-emerald-400 underline underline-offset-8 transition-colors"
                  : "text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              }
            >
              {day.label}
            </button>
          )
        })}
      </div>
    </SectionCard>
  )
}
