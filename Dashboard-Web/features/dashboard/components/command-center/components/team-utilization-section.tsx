/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion } from "framer-motion"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface TeamUtilizationSectionProps {
  project: ProjectData
  onNavigate?: (id: string, state?: Record<string, unknown>) => void
}

export function TeamUtilizationSection({ project, onNavigate }: TeamUtilizationSectionProps) {
  const d = project
  return (
    <SectionCard className="flex flex-col">
      <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mb-6 w-full">
        Team Utilization
      </h3>
      <p className="mb-4 text-xs font-medium text-slate-500 dark:text-slate-400">Hours tracked this week against each member&apos;s weekly capacity</p>

      {/* Donut */}
      <div className="relative w-44 h-44 mb-6 self-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="transparent" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="12" />
          <circle cx="50" cy="50" r="40" fill="transparent" className="stroke-rose-500 dark:stroke-rose-400"
            strokeWidth="12" strokeDasharray="251.2"
            strokeDashoffset={Math.max(d.utilizationOffset + 80, 200)}
            strokeLinecap="round"
          />
          <motion.circle
            cx="50" cy="50" r="40" fill="transparent" className="stroke-emerald-500 dark:stroke-emerald-400"
            strokeWidth="12" strokeDasharray="251.2"
            strokeLinecap="round"
            initial={{ strokeDashoffset: 251.2 }}
            animate={{ strokeDashoffset: d.utilizationOffset }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={d.id + "-util"}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight"
          >
            {d.utilizationPercent}%
          </motion.span>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase">Utilized</span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full space-y-3 mb-6">
        {[
          { dot: "bg-emerald-500 dark:bg-emerald-400", label: "Optimal Load",  value: `${d.utilizationMembers.optimal} Members` },
          { dot: "bg-rose-500 dark:bg-rose-400",   label: "Over Capacity", value: `${d.utilizationMembers.over} Members`    },
          { dot: "bg-slate-200 dark:bg-slate-700", label: "Underutilized", value: `${d.utilizationMembers.under} Members`   },
        ].map((row, i) => (
          <div key={row.label} className="flex justify-between items-center text-sm font-medium">
            <div className="flex items-center gap-2.5">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${row.dot}`} />
              <span className="text-slate-500 dark:text-slate-400 font-medium">{row.label}</span>
            </div>
            <motion.span
              key={d.id + "-util-" + row.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08 }}
              className="font-bold text-slate-900 dark:text-slate-100"
            >
              {row.value}
            </motion.span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onNavigate?.("pm-tasks", { view: "board" })}
        className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700/80 transition-all shadow-sm" type="button"
      >
        Adjust Workload
      </button>
    </SectionCard>
  )
}
