"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { Activity } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { ProjectActivityRow } from "@/features/projects/mappers/project-mapper"
import { MAX_TASKS_PER_PROJECT, TASK_PANEL_HEIGHT_CLASS } from "@/features/projects/constants/project-constants"
import { budgetBarClass, overviewTheme, type Segment } from "@/features/projects/components/overview/overview-theme"

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "blocked", label: "Blocked" },
  { key: "todo", label: "To do" },
]

interface ActivitySummaryProps {
  activity: ProjectActivityRow[]
  isDark?: boolean
  className?: string
}

export function ActivitySummary({ activity, isDark = false, className }: ActivitySummaryProps) {
  const t = overviewTheme(isDark)
  const projectActivity = useMemo(() => activity.slice(0, MAX_TASKS_PER_PROJECT), [activity])

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm", TASK_PANEL_HEIGHT_CLASS, t.card, className)}>
      <div className={cn("flex items-center gap-2 px-6 py-4 border-b", t.border)}>
        <Activity className={cn("w-4 h-4", t.icon)} />
        <h3 className={cn("text-sm font-bold", t.title)}>Tasks per Project</h3>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-between p-4">
        <div className="flex flex-col gap-4">
          {projectActivity.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", t.emptyIconWrap)}>
                <Activity className={cn("w-6 h-6", t.emptyIcon)} />
              </div>
              <p className={cn("text-sm font-medium", t.text)}>No tasks found</p>
              <p className={cn("text-xs mt-1", t.muted)}>Projects with tasks will appear here</p>
            </div>
          ) : (
            projectActivity.map((p, i) => {
              const budgetPct =
                p.budget && p.budget.total > 0 ? Math.min(Math.round((p.budget.spent / p.budget.total) * 100), 100) : null
              return (
                <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className={cn("text-xs font-medium truncate max-w-[140px]", t.text)}>{p.name}</span>
                    </div>
                    {budgetPct !== null ? (
                      <div className={cn("flex items-center gap-2 text-[10px] tabular-nums", t.muted)}>
                        <span className={cn("font-semibold", t.secondary)}>{budgetPct}% of budget</span>
                        <span aria-hidden>·</span>
                        <span>
                          {p.total} task{p.total === 1 ? "" : "s"}
                        </span>
                      </div>
                    ) : (
                      <div className={cn("flex items-center gap-2 text-[10px] tabular-nums", t.muted)}>
                        <span className={cn("font-semibold", t.success)}>{p.done} done</span>
                        <span aria-hidden>·</span>
                        <span>{p.total} total</span>
                      </div>
                    )}
                  </div>
                  {budgetPct !== null ? (
                    <div className={cn("h-2 rounded-full overflow-hidden", t.track)}>
                      <div className={cn("h-full rounded-full", budgetBarClass(budgetPct, t))} style={{ width: `${budgetPct}%` }} />
                    </div>
                  ) : (
                    <div className={cn("flex h-2 rounded-full overflow-hidden gap-px", t.track)}>
                      {SEGMENTS.map(({ key }) =>
                        p[key] > 0 ? (
                          <div key={key} className={t.segment[key]} style={{ width: `${(p[key] / p.total) * 100}%` }} />
                        ) : null,
                      )}
                    </div>
                  )}
                </motion.div>
              )
            })
          )}
        </div>
        {projectActivity.some((p) => !p.budget || p.budget.total <= 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 mt-auto">
            {SEGMENTS.map((segment) => (
              <div key={segment.key} className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", t.segment[segment.key])} />
                <span className={cn("text-[10px]", t.muted)}>{segment.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
