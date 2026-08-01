"use client"

import type { ReactNode } from "react"
import { formatDecimalHoursClock } from "@/features/reports/utils/time-and-activity"
import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

export function ReportPeriodMetricCell({ day, colKey }: { day: TimeActivityDayRow; colKey: string }): ReactNode {
  switch (colKey) {
    case "client":
      return <span className="text-sm text-slate-500 dark:text-slate-400">{day.client}</span>
    case "team":
      return <span className="text-sm text-slate-500 dark:text-slate-400">{day.team}</span>
    case "todo":
      return <span className="text-sm text-slate-500 dark:text-slate-400">{day.todo}</span>
    case "project":
      return (
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-[10px] font-bold text-blue-600 dark:text-blue-400">
            {day.projectCount}
          </div>
          <span className="text-sm text-slate-600 dark:text-slate-300">Projects</span>
        </div>
      )
    case "regular_hours":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{day.regularHours}</span>
    case "break_time":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{day.breakTime}</span>
    case "manual_hours":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{formatDecimalHoursClock(day.manualHours)}</span>
    case "total_hours":
      return <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{day.totalHours}</span>
    case "activity_pct":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{day.activityPct}%</span>
    case "idle_pct":
      return <span className="text-sm text-slate-500 dark:text-slate-400">{day.idlePct}</span>
    case "idle_hr":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{day.idleHr}</span>
    case "total_spent":
      return <span className="text-sm text-slate-700 dark:text-slate-200">{day.totalSpent}</span>
    default:
      return null
  }
}

