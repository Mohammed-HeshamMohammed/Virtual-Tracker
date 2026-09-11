"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Folder, ExternalLink } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewProject } from "@/features/projects/mappers/project-mapper"
import { BudgetBar } from "@/features/projects/components/overview/components/budget-bar"
import { overviewTheme, type Tone } from "@/features/projects/components/overview/overview-theme"

const HEALTH_CONFIG: Record<"on_track" | "at_risk" | "stalled", { label: string; tone: Tone }> = {
  on_track: { label: "On Track", tone: "success" },
  at_risk: { label: "At Risk", tone: "warning" },
  stalled: { label: "Stalled", tone: "neutral" },
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
  const t = overviewTheme(isDark)
  const containerRef = useRef<HTMLDivElement>(null)
  const firstRowRef = useRef<HTMLTableRowElement>(null)
  const [visibleCount, setVisibleCount] = useState(() => Math.min(projects.length, 7))

  useLayoutEffect(() => {
    const container = containerRef.current
    const row = firstRowRef.current
    if (!container || !row || projects.length === 0) return

    const compute = () => {
      const rowHeight = row.getBoundingClientRect().height
      if (!rowHeight) return
      const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 0
      const fit = Math.max(1, Math.floor((container.clientHeight - headerHeight) / rowHeight))
      setVisibleCount((prev) => {
        const next = Math.min(fit, projects.length)
        return prev === next ? prev : next
      })
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [projects.length])

  const activeProjects = useMemo(() => projects.slice(0, visibleCount), [projects, visibleCount])
  const th = cn("text-left text-[10px] font-semibold uppercase tracking-wider py-2.5", t.muted)

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border shadow-sm", t.card, className)}>
      <div className={cn("flex shrink-0 items-center justify-between border-b px-6 py-4", t.border)}>
        <div className="flex items-center gap-2">
          <Folder className={cn("w-4 h-4", t.icon)} />
          <h3 className={cn("text-sm font-bold", t.title)}>Projects Overview</h3>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold tabular-nums", t.countPill)}>
            {activeProjects.length}
          </span>
        </div>
        <button
          onClick={() => onNavigate?.("pm-projects")}
          className={cn("text-xs font-semibold hover:underline flex items-center gap-1", t.link)}
          type="button"
        >
          All projects <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
        <table className="w-full h-full">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className={cn("border-b", t.border, t.tableHead)}>
              <th className={cn(th, "px-6")}>Project</th>
              <th className={cn(th, "px-4")}>Health</th>
              <th className={cn(th, "px-4")}>Progress</th>
              <th className={cn(th, "px-4")}>Budget</th>
              <th className={cn(th, "px-4")}>Members</th>
            </tr>
          </thead>
          <tbody className={cn("divide-y", t.divide)}>
            {activeProjects.map((p, i) => {
              const hCfg = HEALTH_CONFIG[p.health as keyof typeof HEALTH_CONFIG] as
                | { label: string; tone: Tone }
                | undefined
              const todoPct = p.todos.total > 0 ? Math.round((p.todos.done / p.todos.total) * 100) : 0
              return (
                <motion.tr
                  key={p.id}
                  ref={i === 0 ? firstRowRef : undefined}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 + i * 0.05 }}
                  onClick={() => onNavigate?.("pm-projects")}
                  className={cn("transition-colors group cursor-pointer", t.rowHover)}
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className={cn("text-sm font-medium", t.text)}>{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {hCfg ? (
                      <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full", t.badge[hCfg.tone])}>
                        {hCfg.label}
                      </span>
                    ) : (
                      <span className={cn("text-xs", t.muted)}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-20 h-1.5 rounded-full overflow-hidden", t.track)}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${todoPct}%` }}
                          transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                      </div>
                      <span className={cn("text-xs tabular-nums", t.secondary)}>{todoPct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {p.budget?.total ? (
                      <BudgetBar used={p.budget.spent} total={p.budget.total} type={p.budget.type} mini />
                    ) : (
                      <span className={cn("text-xs", t.muted)}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("text-sm tabular-nums", t.secondary)}>{p.members}</span>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {projects.length > activeProjects.length && (
        <button
          onClick={() => onNavigate?.("pm-projects")}
          className={cn("shrink-0 border-t px-6 py-2.5 text-left text-xs font-semibold hover:underline", t.border, t.link)}
          type="button"
        >
          +{projects.length - activeProjects.length} more project{projects.length - activeProjects.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  )
}
