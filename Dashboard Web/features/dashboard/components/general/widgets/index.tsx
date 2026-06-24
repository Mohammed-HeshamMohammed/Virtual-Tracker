"use client"

import dynamic from "next/dynamic"
import { Suspense } from "react"
import { Loader2 } from "lucide-react"
import { StatWidget } from "@/features/dashboard/components/general/widgets/stat-widgets"
import { TodosPanel } from "@/features/dashboard/components/general/widgets/todos-panel"
import { WhosOnlinePanel } from "@/features/dashboard/components/general/widgets/whos-online-panel"

const ScreenshotsPanel = dynamic(() => import("@/features/dashboard/components/general/widgets/screenshots-panel").then((m) => m.ScreenshotsPanel), {
  loading: () => <WidgetLazyFallback />,
})
const AppsUrlsPanel = dynamic(() => import("@/features/dashboard/components/general/widgets/apps-urls-panel").then((m) => m.AppsUrlsPanel), {
  loading: () => <WidgetLazyFallback />,
})
const BudgetsPanel = dynamic(() => import("@/features/dashboard/components/general/widgets/budgets-panel").then((m) => m.BudgetsPanel), {
  loading: () => <WidgetLazyFallback />,
})
const WeeklyActivityPanel = dynamic(() => import("@/features/dashboard/components/general/widgets/weekly-activity-panel").then((m) => m.WeeklyActivityPanel), {
  loading: () => <WidgetLazyFallback />,
})
const RecentProjectsPanel = dynamic(() => import("@/features/dashboard/components/general/widgets/recent-projects-panel").then((m) => m.RecentProjectsPanel), {
  loading: () => <WidgetLazyFallback />,
})

function WidgetLazyFallback() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-3xl border border-slate-100 bg-white shadow-sm">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
    </div>
  )
}

export function DashboardWidget({
  id,
  onNavigate,
}: {
  id: string
  onNavigate?: (routeId: string) => void
}) {
  switch (id) {
    case "worked_week":
    case "worked_today":
    case "activity_today":
    case "activity_week":
    case "spent_week":
    case "spent_today":
    case "members":
    case "projects":
      return <StatWidget id={id} />
    case "todos":
      return <TodosPanel />
    case "online":
      return <WhosOnlinePanel />
    case "screenshots":
      return (
        <Suspense fallback={<WidgetLazyFallback />}>
          <ScreenshotsPanel onNavigate={onNavigate} />
        </Suspense>
      )
    case "apps_urls":
      return (
        <Suspense fallback={<WidgetLazyFallback />}>
          <AppsUrlsPanel onNavigate={onNavigate} />
        </Suspense>
      )
    case "budgets":
      return (
        <Suspense fallback={<WidgetLazyFallback />}>
          <BudgetsPanel />
        </Suspense>
      )
    case "weekly_activity":
      return (
        <Suspense fallback={<WidgetLazyFallback />}>
          <WeeklyActivityPanel />
        </Suspense>
      )
    case "recent_projects":
      return (
        <Suspense fallback={<WidgetLazyFallback />}>
          <RecentProjectsPanel onNavigate={onNavigate} />
        </Suspense>
      )
    default:
      return null
  }
}
