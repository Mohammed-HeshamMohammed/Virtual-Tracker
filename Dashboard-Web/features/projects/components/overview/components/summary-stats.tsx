"use client"

import { motion } from "framer-motion"
import { Folder, CheckCircle2, DollarSign, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { ProjectOverviewCore } from "@/features/projects/api/project-overview-api"
import { fmt$ } from "@/features/projects/components/overview/components/budget-bar"
import { overviewTheme } from "@/features/projects/components/overview/overview-theme"

interface SummaryStatsProps {
  summary: ProjectOverviewCore["summary"]
  isDark?: boolean
  onNavigate?: (id: string) => void
}

export function SummaryStats({ summary, isDark = false, onNavigate }: SummaryStatsProps) {
  const { activeProjects, onTrack, tasksDone, tasksTotal, budgetSpent, budgetTotal, teamMembers } = summary
  const t = overviewTheme(isDark)

  const stats = [
    {
      icon: <Folder className="w-5 h-5" />,
      bg: "bg-indigo-500",
      label: "Active Projects",
      value: String(activeProjects),
      sub: `${onTrack} on track`,
      target: "pm-projects",
    },
    {
      icon: <CheckCircle2 className="w-5 h-5" />,
      bg: "bg-emerald-500",
      label: "Tasks Completed",
      value: `${tasksDone}/${tasksTotal}`,
      sub: tasksTotal > 0 ? `${Math.round((tasksDone / tasksTotal) * 100)}% completion` : "0% completion",
      target: "pm-tasks",
    },
    {
      icon: <DollarSign className="w-5 h-5" />,
      bg: "bg-amber-500",
      label: "Budget Used",
      value: fmt$(budgetSpent),
      sub: `of ${fmt$(budgetTotal)} total`,
      target: "pm-projects",
    },
    {
      icon: <Users className="w-5 h-5" />,
      bg: "bg-cyan-500",
      label: "Team Members",
      value: String(teamMembers),
      sub: `across ${activeProjects} projects`,
      target: "pm-projects",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          onClick={() => onNavigate?.(s.target)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onNavigate?.(s.target)
            }
          }}
          className={cn(
            "rounded-2xl p-5 border shadow-sm cursor-pointer outline-none transition-shadow hover:shadow-md",
            t.card,
            t.focusRing,
          )}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-white", s.bg)}>
              {s.icon}
            </div>
          </div>
          <p className={cn("text-2xl font-bold tabular-nums", t.title)}>{s.value}</p>
          <p className={cn("text-sm mt-0.5", t.secondary)}>{s.label}</p>
          <p className={cn("text-xs mt-1", t.muted)}>{s.sub}</p>
        </motion.div>
      ))}
    </div>
  )
}
