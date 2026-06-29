"use client"

import { motion } from "framer-motion"
import { ExternalLink, Globe } from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"
import { formatSecondsAsHhMm } from "@/features/dashboard/components/general/shared/format"

export function AppsUrlsPanel({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const apps = viewData?.topApps ?? []

  return (
    <PanelShell
      title="Apps & URLs"
      subtitle="Top applications this week"
      icon={<Globe className="h-5 w-5" />}
      iconClassName="bg-purple-500"
      loading={loading}
      error={error}
      onRetry={retry}
      empty={!loading && apps.length === 0}
      emptyMessage="No app activity recorded yet."
      action={
        <button
          type="button"
          onClick={() => onNavigate?.("activity-apps")}
          className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
        >
          View all <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <ul className="space-y-3">
        {apps.map((app, i) => (
          <li key={app.name} className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
              {app.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">{app.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatSecondsAsHhMm(app.totalSeconds)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${app.percent}%` }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="h-full rounded-full bg-purple-500"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </PanelShell>
  )
}
