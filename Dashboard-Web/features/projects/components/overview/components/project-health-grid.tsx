/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion } from "framer-motion"
import { Folder, ExternalLink } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewProject } from "@/features/projects/mappers/project-mapper"
import { BudgetBar } from "@/features/projects/components/overview/components/budget-bar"

const HEALTH_CONFIG = {
  on_track: { label: "On Track", color: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  at_risk: { label: "At Risk", color: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-500" },
  stalled: { label: "Stalled", color: "text-slate-400", bg: "bg-slate-100", dot: "bg-slate-300" },
}

interface ProjectHealthGridProps {
  projects: OverviewProject[]
  isDark?: boolean
  onNavigate?: (id: string) => void
  className?: string
}

export function ProjectHealthGrid({
  projects,
  isDark = false,
  onNavigate,
  className,
}: ProjectHealthGridProps) {
  const activeProjects = projects.slice(0, 7)

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border shadow-sm",
        isDark ? "bg-[#0c1324] border-[#3d4a3d]/40" : "bg-white border-slate-100",
        className,
      )}
    >
      <div className={cn("flex shrink-0 items-center justify-between border-b px-6 py-4", isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">Projects Overview</h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">{activeProjects.length}</span>
        </div>
        <button
          onClick={() => onNavigate?.("pm-projects")}
          className="text-xs text-green-700 font-semibold hover:underline flex items-center gap-1" type="button"
        >
          All projects <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
        <table className="w-full h-full">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className={cn("border-b bg-slate-50/50", isDark ? "border-[#3d4a3d]/40 bg-[#191f31]/80" : "border-slate-50")}>
              <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-6 py-2.5">Project</th>
              <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-4 py-2.5">Health</th>
              <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-4 py-2.5">Progress</th>
              <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-4 py-2.5">Budget</th>
              <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-4 py-2.5">Members</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {activeProjects.map((p, i) => {
              const hCfg = HEALTH_CONFIG[p.health as keyof typeof HEALTH_CONFIG]
              const todoPct = p.todos.total > 0 ? Math.round((p.todos.done / p.todos.total) * 100) : 0
              return (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 + i * 0.05 }}
                  onClick={() => onNavigate?.("pm-projects")}
                  className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="text-sm font-medium text-slate-700">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {hCfg ? (
                      <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full", hCfg.color, hCfg.bg)}>
                        {hCfg.label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${todoPct}%` }}
                          transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">{todoPct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {p.budget?.total ? (
                      <BudgetBar used={p.budget.spent} total={p.budget.total} mini />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-sm text-slate-600">
                      {p.members}
                      {p.memberLimit && <span className="text-slate-300">/{p.memberLimit}</span>}
                    </span>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
