"use client"

import {
  Activity,
  Clock,
  FolderKanban,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { StatShell } from "@/features/dashboard/components/general/components/widget-shell"
import { formatDecimalHoursAsClock } from "@/features/dashboard/components/general/shared/format"

type StatWidgetId =
  | "worked_week"
  | "worked_today"
  | "activity_today"
  | "activity_week"
  | "spent_week"
  | "spent_today"
  | "members"
  | "projects"

export function StatWidget({ id }: { id: StatWidgetId }) {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const stats = viewData?.stats

  if (!stats && !loading && !error) return null

  const common = { loading, error, onRetry: retry }

  switch (id) {
    case "worked_week":
      return (
        <StatShell
          {...common}
          icon={<TrendingUp className="h-5 w-5" />}
          iconClassName="bg-indigo-500"
          label="Worked this week"
          value={formatDecimalHoursAsClock(stats?.workedWeekHours ?? 0)}
        />
      )
    case "worked_today":
      return (
        <StatShell
          {...common}
          icon={<Clock className="h-5 w-5" />}
          iconClassName="bg-cyan-500"
          label="Worked today"
          value={formatDecimalHoursAsClock(stats?.workedTodayHours ?? 0)}
        />
      )
    case "activity_today":
      return (
        <StatShell
          {...common}
          icon={<Activity className="h-5 w-5" />}
          iconClassName="bg-purple-500"
          label="Activity today"
          value={`${stats?.activityTodayPercent ?? 0}%`}
        />
      )
    case "activity_week":
      return (
        <StatShell
          {...common}
          icon={<Activity className="h-5 w-5" />}
          iconClassName="bg-violet-500"
          label="Activity this week"
          value={`${stats?.activityWeekPercent ?? 0}%`}
        />
      )
    case "spent_week":
      return (
        <StatShell
          {...common}
          icon={<Wallet className="h-5 w-5" />}
          iconClassName="bg-emerald-500"
          label="Billable this week"
          value={formatDecimalHoursAsClock(stats?.spentWeekHours ?? 0)}
        />
      )
    case "spent_today":
      return (
        <StatShell
          {...common}
          icon={<Wallet className="h-5 w-5" />}
          iconClassName="bg-teal-500"
          label="Billable today"
          value={formatDecimalHoursAsClock(stats?.spentTodayHours ?? 0)}
        />
      )
    case "members":
      return (
        <StatShell
          {...common}
          icon={<Users className="h-5 w-5" />}
          iconClassName="bg-blue-500"
          label="Members worked"
          value={String(stats?.membersWorkedToday ?? 0)}
        />
      )
    case "projects":
      return (
        <StatShell
          {...common}
          icon={<FolderKanban className="h-5 w-5" />}
          iconClassName="bg-orange-500"
          label="Projects worked"
          value={String(stats?.projectsWorkedToday ?? 0)}
        />
      )
    default:
      return null
  }
}
