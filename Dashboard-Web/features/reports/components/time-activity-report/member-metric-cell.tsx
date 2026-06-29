"use client"

import type { ReactNode } from "react"
import { formatDecimalHoursClock } from "@/features/reports/utils/time-and-activity"
import type { TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"

export function ReportMemberMetricCell({
  member,
  colKey,
}: {
  member: TimeActivityMemberSubRow
  colKey: string
}): ReactNode {
  switch (colKey) {
    case "client":
    case "team":
    case "todo":
    case "project":
      return <span className="text-sm text-slate-400">-</span>
    case "regular_hours":
      return <span className="text-sm text-slate-700">{member.regularHours}</span>
    case "break_time":
      return <span className="text-sm text-slate-700">{member.breakTime}</span>
    case "manual_hours":
      return <span className="text-sm text-slate-700">{formatDecimalHoursClock(member.manualHours)}</span>
    case "total_hours":
      return <span className="text-sm font-medium text-slate-700">{member.totalHours}</span>
    case "activity_pct":
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${member.activityPct}%`,
                backgroundColor:
                  member.activityPct >= 70 ? "#22c55e" : member.activityPct >= 40 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <span className="text-sm text-slate-700">{member.activityPct}%</span>
        </div>
      )
    case "idle_pct":
      return <span className="text-sm text-slate-400">{member.idlePct}</span>
    case "idle_hr":
      return <span className="text-sm text-slate-700">{member.idleHr}</span>
    case "total_spent":
      return <span className="text-sm text-slate-700">{member.totalSpent}</span>
    default:
      return null
  }
}

