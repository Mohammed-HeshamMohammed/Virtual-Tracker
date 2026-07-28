/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"
import { useCommandCenterData } from "@/features/dashboard/hooks/use-command-center-data"
import { ProjectSelector } from "@/features/dashboard/components/command-center/components/project-selector"
import { StatCardsSection } from "@/features/dashboard/components/command-center/components/stat-cards-section"
import { ProductivityTrendsSection } from "@/features/dashboard/components/command-center/components/productivity-trends-section"
import { MilestonesSection } from "@/features/dashboard/components/command-center/components/milestones-section"
import { ActivityFeedSection } from "@/features/dashboard/components/command-center/components/activity-feed-section"
import { TeamUtilizationSection } from "@/features/dashboard/components/command-center/components/team-utilization-section"
import { CommandCenterSkeleton } from "@/features/dashboard/components/command-center/command-center-skeleton"
import { WidgetErrorBoundary } from "@/shared/ui/widget-error-boundary"
import { useTheme } from "@/shared/providers/app"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"

export function CommandCenter({ onNavigate }: { onNavigate?: (id: string, state?: Record<string, unknown>) => void }) {
  const { isDark } = useTheme()
  const { projects, globalActivityFeed, loading, error, refreshing, retry } = useCommandCenterData()
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null)

  const activeProject = useMemo(() => {
    if (!projects.length) return null
    if (selectedProject) {
      return projects.find((project) => project.id === selectedProject.id) ?? projects[0]
    }
    return projects[0]
  }, [projects, selectedProject])

  useEffect(() => {
    if (!projects.length) {
      setSelectedProject(null)
      return
    }
    if (!selectedProject || !projects.some((project) => project.id === selectedProject.id)) {
      setSelectedProject(projects[0])
    }
  }, [projects, selectedProject])

  if (loading && !activeProject) {
    return <CommandCenterSkeleton />
  }

  if (error && !activeProject) {
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

  if (!activeProject) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 px-8 text-center">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">No projects yet</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">Create a project to populate the Command Center.</p>
        <button
          type="button"
          onClick={() => onNavigate?.("pm-projects")}
          className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 px-4 py-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
        >
          Go to Projects
        </button>
      </div>
    )
  }

  const d = activeProject

  return (
    <div className="w-full h-full min-h-[800px]">
      <div className="w-full space-y-8 pb-8">
        <div className="sticky top-0 z-30 bg-inherit pt-2 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <span className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-full uppercase tracking-wide">
                Last 7 Days
              </span>
              {refreshing && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Refreshing
                </span>
              )}
            </div>
            <ProjectSelector projects={projects} selected={d} onSelect={setSelectedProject} />
          </motion.div>
          {error && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/60 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
              <span>Showing cached data — latest refresh failed.</span>
              <button type="button" onClick={retry} className="font-bold underline">
                Retry
              </button>
            </div>
          )}
        </div>

        <WidgetErrorBoundary label="Summary stats" isDark={isDark} onRetry={retry}>
          <StatCardsSection project={d} />
        </WidgetErrorBoundary>

        <AnimatePresence mode="wait">
          <motion.div
            key={d.id + "-mid"}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <WidgetErrorBoundary label="Productivity trends" isDark={isDark} onRetry={retry}>
              <ProductivityTrendsSection project={d} />
            </WidgetErrorBoundary>
            <WidgetErrorBoundary label="Milestones" isDark={isDark} onRetry={retry}>
              <MilestonesSection project={d} onNavigate={onNavigate} />
            </WidgetErrorBoundary>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={d.id + "-bottom"}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <WidgetErrorBoundary label="Activity feed" isDark={isDark} onRetry={retry}>
              <ActivityFeedSection feed={globalActivityFeed} onNavigate={onNavigate} />
            </WidgetErrorBoundary>
            <WidgetErrorBoundary label="Team utilization" isDark={isDark} onRetry={retry}>
              <TeamUtilizationSection project={d} onNavigate={onNavigate} />
            </WidgetErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
