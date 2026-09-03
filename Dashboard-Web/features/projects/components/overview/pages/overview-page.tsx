"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { useTheme, useAuth } from "@/shared/providers/app"
import { canSeeClientBudgets } from "@/features/auth/permissions/member-role-access"
import { OverviewSkeleton } from "@/features/projects/components/overview/skeletons/overview-skeleton"
import { sortProjectsForOverview } from "@/features/projects/utils/overview-sort"
import {
  mapCoreProjects,
  mapPanelActivity,
  mapPanelClient,
  mapPanelTask,
} from "@/features/projects/mappers/project-mapper"
import { useProjectOverview } from "@/features/projects/hooks/use-project-overview"

import { SummaryStats } from "@/features/projects/components/overview/components/summary-stats"
import { ProjectHealthGrid } from "@/features/projects/components/overview/components/project-health-grid"
import { BelowFoldPanels } from "@/features/projects/components/overview/components/below-fold-panels"

export function ProjectManagementOverview({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { isDark } = useTheme()
  const { memberRole } = useAuth()
  const showClientBudgets = canSeeClientBudgets(memberRole)

  const {
    core,
    panels,
    isCoreLoading,
    panelsError,
    loadPanels,
    belowFoldRef,
  } = useProjectOverview()

  const projects = useMemo(() => (core ? mapCoreProjects(core) : []), [core])

  const sortedActiveProjects = useMemo(
    () => sortProjectsForOverview(projects.filter(p => p.status === "active")),
    [projects],
  )

  const projectNames = useMemo(
    () => Object.fromEntries(projects.map(p => [p.id, p.name])),
    [projects],
  )

  const panelTasks = useMemo(
    () => (panels ? panels.tasks.map(mapPanelTask) : []),
    [panels],
  )

  const panelActivity = useMemo(
    () => (panels ? panels.projectActivity.map(mapPanelActivity) : []),
    [panels],
  )

  const panelClients = useMemo(
    () => (panels ? panels.clients.map(mapPanelClient) : []),
    [panels],
  )

  const assigneeNames = panels?.assignees ?? {}

  if (isCoreLoading || !core) {
    return <OverviewSkeleton isDark={isDark} />
  }

  return (
    <motion.div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-6 scrollbar-hide">
        <section className="flex min-h-full flex-col gap-4">
          <motion.div className="shrink-0" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <SummaryStats summary={core.summary} isDark={isDark} onNavigate={onNavigate} />
          </motion.div>

          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
          >
            <ProjectHealthGrid
              projects={sortedActiveProjects}
              isDark={isDark}
              onNavigate={onNavigate}
              className="h-full min-h-0 flex-1"
            />
          </motion.div>
        </section>

        <BelowFoldPanels
          isDark={isDark}
          onNavigate={onNavigate}
          belowFoldRef={belowFoldRef}
          hasPanels={panels !== null}
          panelsError={panelsError}
          onRetryPanels={() => void loadPanels()}
          tasks={panelTasks}
          projectNames={projectNames}
          assigneeNames={assigneeNames}
          activity={panelActivity}
          clients={panelClients}
          showClientBudgets={showClientBudgets}
        />
      </div>
    </motion.div>
  )
}