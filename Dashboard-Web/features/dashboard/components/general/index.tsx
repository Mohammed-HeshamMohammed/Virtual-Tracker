"use client"

import { useState } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { useGeneralDashboardData } from "@/features/dashboard/hooks/use-general-dashboard-data"
import { GeneralDashboardProvider } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { DashboardGrid } from "@/features/dashboard/components/general/components/dashboard-grid"
import { GeneralDashboardSkeleton } from "@/features/dashboard/components/general/general-dashboard-skeleton"
import { ViewToggle } from "@/features/dashboard/components/general/components/view-toggle"
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardView } from "@/features/dashboard/components/general/constants"
import { useTheme } from "@/shared/providers/app"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"

export function GeneralDashboard({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { isDark } = useTheme()
  const [view, setView] = useState<DashboardView>("me")
  const { data: payload, loading, error, refreshing, retry } = useGeneralDashboardData()

  if (loading && !payload) {
    return <GeneralDashboardSkeleton />
  }

  if (error && !payload) {
    return (
      <DashboardStatusShell isDark={isDark} mode="embedded">
        <DashboardStatusContent
          isDark={isDark}
          icon={AlertCircle}
          iconTone="error"
          badge="Dashboard"
          title="Unable to load dashboard data"
          description={error}
          primaryLabel="Retry"
          primaryIcon={RefreshCw}
          onPrimary={retry}
        />
      </DashboardStatusShell>
    )
  }

  return (
    <GeneralDashboardProvider
      view={view}
      setView={setView}
      payload={payload}
      loading={loading}
      error={error}
      refreshing={refreshing}
      retry={retry}
    >
      <div className="w-full space-y-6 pb-8">
        <div className="flex items-center justify-between gap-4">
          <ViewToggle view={view} onChange={setView} canAccessAllView={payload?.canAccessAllView ?? false} />
        </div>
        <DashboardGrid blocks={DEFAULT_DASHBOARD_LAYOUT} onNavigate={onNavigate} />
      </div>
    </GeneralDashboardProvider>
  )
}
