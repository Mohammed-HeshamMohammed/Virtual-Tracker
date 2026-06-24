"use client"

import { motion } from "framer-motion"
import { ExternalLink, FolderKanban } from "lucide-react"
import { PROJECT_COLORS } from "@/features/dashboard/components/general/constants"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"

export function RecentProjectsPanel({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const projects = viewData?.recentProjects ?? []

  return (
    <PanelShell
      title="Recent projects"
      subtitle="Progress across active work"
      icon={<FolderKanban className="h-5 w-5" />}
      iconClassName="bg-violet-500"
      loading={loading}
      error={error}
      onRetry={retry}
      empty={!loading && projects.length === 0}
      emptyMessage="No projects in your scope yet."
      action={
        <button
          type="button"
          onClick={() => onNavigate?.("pm-projects")}
          className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
        >
          All projects <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <ul className="space-y-3">
        {projects.map((project, i) => {
          const color = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length] ?? "bg-slate-400"
          return (
            <li key={project.id} className="flex items-center gap-3">
              <div className={`h-10 w-1 shrink-0 rounded-full ${color}`} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">{project.name}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-500">{project.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${project.progress}%` }}
                    transition={{ duration: 0.5, delay: i * 0.06 }}
                    className={`h-full rounded-full ${color}`}
                  />
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-slate-400">{project.memberCount} members</span>
            </li>
          )
        })}
      </ul>
    </PanelShell>
  )
}
