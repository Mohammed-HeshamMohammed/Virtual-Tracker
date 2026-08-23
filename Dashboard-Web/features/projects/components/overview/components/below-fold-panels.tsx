/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion } from "framer-motion"
import { Loader2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewTaskCard, ProjectActivityRow, OverviewClientRow } from "@/features/projects/mappers/project-mapper"
import { TasksBreakdown } from "@/features/projects/components/overview/components/tasks-breakdown"
import { ActivitySummary } from "@/features/projects/components/overview/components/activity-summary"
import { ClientBudgets } from "@/features/projects/components/overview/components/client-budgets"

interface BelowFoldPanelsProps {
  isDark: boolean
  onNavigate?: (id: string) => void
  belowFoldRef: (node: HTMLElement | null) => void
  hasPanels: boolean
  panelsError: Error | null
  onRetryPanels: () => void
  tasks: OverviewTaskCard[]
  projectNames: Record<string, string>
  assigneeNames: Record<string, string>
  activity: ProjectActivityRow[]
  clients: OverviewClientRow[]
  showClientBudgets: boolean
}

export function BelowFoldPanels({
  isDark,
  onNavigate,
  belowFoldRef,
  hasPanels,
  panelsError,
  onRetryPanels,
  tasks,
  projectNames,
  assigneeNames,
  activity,
  clients,
  showClientBudgets,
}: BelowFoldPanelsProps) {
  // Covers both "actively fetching" and "hasn't scrolled into view yet, so
  // the fetch hasn't even started" - without hasPanels, that second window
  // read as isPanelsLoading=false + tasks=[], which fell through to each
  // panel's own genuine "no data" empty state and flashed it before real
  // data ever had a chance to load.
  if (!hasPanels && !panelsError) {
    return (
      <section ref={belowFoldRef} className="mt-6 flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <p className={cn("text-sm", isDark ? "text-[#dce1fb]/70" : "text-slate-500")}>Loading details…</p>
      </section>
    )
  }

  if (panelsError && tasks.length === 0) {
    return (
      <section ref={belowFoldRef} className="mt-6 flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-500">{panelsError.message}</p>
        <button type="button" onClick={onRetryPanels} className="text-xs font-semibold text-green-700 hover:underline">
          Retry
        </button>
      </section>
    )
  }

  return (
    <section ref={belowFoldRef} className="mt-6 flex flex-col gap-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <TasksBreakdown
          tasks={tasks}
          projectNames={projectNames}
          assigneeNames={assigneeNames}
          isDark={isDark}
          onNavigate={onNavigate}
          className="h-full"
        />
        <ActivitySummary activity={activity} isDark={isDark} className="h-full" />
      </motion.div>

      {showClientBudgets && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <ClientBudgets clients={clients} isDark={isDark} onNavigate={onNavigate} />
        </motion.div>
      )}
    </section>
  )
}
