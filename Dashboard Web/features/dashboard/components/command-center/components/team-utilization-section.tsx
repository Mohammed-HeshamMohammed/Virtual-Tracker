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
      <h3 className="text-xl font-bold tracking-tight text-slate-900 mb-6 w-full">
        Team Utilization
      </h3>
      <p className="mb-4 text-xs text-slate-500">Based on active task assignments per member</p>

      {/* Donut */}
      <div className="relative w-44 h-44 mb-6 self-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f2f3ff" strokeWidth="12" />
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#ba1a1a"
            strokeWidth="12" strokeDasharray="251.2"
            strokeDashoffset={Math.max(d.utilizationOffset + 80, 200)}
            strokeLinecap="round"
          />
          <motion.circle
            cx="50" cy="50" r="40" fill="transparent" stroke="#006e2f"
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
            className="text-3xl font-black text-slate-900"
          >
            {d.utilizationPercent}%
          </motion.span>
          <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">Utilized</span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full space-y-3 mb-6">
        {[
          { dot: "bg-green-700", label: "Optimal Load",  value: `${d.utilizationMembers.optimal} Members` },
          { dot: "bg-red-700",   label: "Over Capacity", value: `${d.utilizationMembers.over} Members`    },
          { dot: "bg-slate-200", label: "Underutilized", value: `${d.utilizationMembers.under} Members`   },
        ].map((row, i) => (
          <div key={row.label} className="flex justify-between items-center text-sm font-medium">
            <div className="flex items-center gap-2.5">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${row.dot}`} />
              <span className="text-slate-500">{row.label}</span>
            </div>
            <motion.span
              key={d.id + "-util-" + row.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08 }}
              className="font-bold text-slate-900"
            >
              {row.value}
            </motion.span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onNavigate?.("pm-tasks", { view: "board" })}
        className="w-full py-3 bg-slate-50 text-slate-900 text-sm font-bold rounded-2xl hover:bg-slate-100 transition-all" type="button"
      >
        Adjust Workload
      </button>
    </SectionCard>
  )
}
