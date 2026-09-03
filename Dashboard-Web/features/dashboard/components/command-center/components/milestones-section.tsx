"use client"

import { motion } from "framer-motion"
import { ExternalLink } from "lucide-react"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface MilestonesSectionProps {
  project: ProjectData
  onNavigate?: (id: string, state?: Record<string, unknown>) => void
}

export function MilestonesSection({ project, onNavigate }: MilestonesSectionProps) {
  const d = project
  return (
    <SectionCard>
      <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mb-8">
        {d.id === "all" ? "Project Health" : `${d.name} — Milestones`}
      </h3>
      <div className="space-y-7">
        {d.health.map((p, i) => (
          <motion.div
            key={d.id + p.name}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <div className="flex justify-between items-center mb-2.5 gap-3">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{p.name}</span>
              <span className="flex items-baseline gap-2 shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {p.hint} {p.percent}%
                </span>
                <span className={`text-xs font-black ${p.statusColor}`}>{p.status}</span>
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                key={d.id + p.name + "-bar"}
                initial={{ width: 0 }}
                animate={{ width: `${p.percent}%` }}
                transition={{ duration: 0.7, delay: 0.1 + i * 0.07 }}
                className={`h-full ${p.barColor} rounded-full`}
              />
            </div>
          </motion.div>
        ))}
      </div>
      <button
        onClick={() => onNavigate?.("pm-overview")}
        className="w-full mt-8 py-3 text-sm font-bold text-green-700 dark:text-green-400 border border-green-700/20 dark:border-green-500/30 rounded-xl hover:bg-green-50 dark:hover:bg-green-950/40 transition-colors flex items-center justify-center gap-2" type="button"
      >
        View Detailed Metrics
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </SectionCard>
  )
}
