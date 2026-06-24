/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { Activity } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { ProjectActivityRow } from "@/features/projects/mappers/project-mapper"
import { MAX_TASKS_PER_PROJECT, TASK_PANEL_HEIGHT_CLASS } from "@/features/projects/constants/project-constants"

interface ActivitySummaryProps {
  activity: ProjectActivityRow[]
  isDark?: boolean
  className?: string
}

export function ActivitySummary({ activity, isDark = false, className }: ActivitySummaryProps) {
  const projectActivity = useMemo(() => activity.slice(0, MAX_TASKS_PER_PROJECT), [activity])

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border shadow-sm",
        TASK_PANEL_HEIGHT_CLASS,
        isDark ? "bg-[#0c1324] border-[#3d4a3d]/40" : "bg-white border-slate-100",
        className,
      )}
    >
      <div className={cn("flex items-center gap-2 px-6 py-4 border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
        <Activity className={cn("w-4 h-4", isDark ? "text-[#dce1fb]/50" : "text-slate-400")} />
        <h3 className={cn("text-sm font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Tasks per Project</h3>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-between p-4">
        <div className="flex flex-col gap-4">
          {projectActivity.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", isDark ? "bg-[#191f31]" : "bg-slate-100")}>
                <Activity className={cn("w-6 h-6", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
              </div>
              <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>No tasks found</p>
              <p className={cn("text-xs text-slate-400 mt-1")}>Projects with tasks will appear here</p>
            </div>
          ) : (
            projectActivity.map((p, i) => {
              return (
                <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className={cn("text-xs font-medium truncate max-w-[140px]", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                        {p.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="text-emerald-600 font-semibold">{p.done} done</span>
                      <span>·</span>
                      <span>{p.total} total</span>
                    </div>
                  </div>
                  {/* Stacked bar */}
                  <div className="flex h-2 rounded-full overflow-hidden gap-px">
                    {p.done > 0 && <div className="bg-emerald-400" style={{ width: `${(p.done / p.total) * 100}%` }} />}
                    {p.in_progress > 0 && <div className="bg-blue-400" style={{ width: `${(p.in_progress / p.total) * 100}%` }} />}
                    {p.in_review > 0 && <div className="bg-amber-400" style={{ width: `${(p.in_review / p.total) * 100}%` }} />}
                    {p.blocked > 0 && <div className="bg-red-400" style={{ width: `${(p.blocked / p.total) * 100}%` }} />}
                    {p.todo > 0 && <div className="bg-slate-200" style={{ width: `${(p.todo / p.total) * 100}%` }} />}
                  </div>
                </motion.div>
              )
            })
          )}
        </div>
        {/* Legend */}
        {projectActivity.length > 0 && (
          <div className="flex items-center gap-4 pt-3 mt-auto">
            {[
              { color: "bg-emerald-400", label: "Done" },
              { color: "bg-blue-400", label: "In Progress" },
              { color: "bg-amber-400", label: "In Review" },
              { color: "bg-red-400", label: "Blocked" },
              { color: "bg-slate-200", label: "To do" },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", l.color)} />
                <span className="text-[10px] text-slate-400">{l.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
