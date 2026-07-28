"use client"

import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import type { DashboardView } from "@/features/dashboard/components/general/constants"

export function ViewToggle({
  view,
  onChange,
  canAccessAllView,
}: {
  view: DashboardView
  onChange: (view: DashboardView) => void
  canAccessAllView: boolean
}) {
  const options: DashboardView[] = canAccessAllView ? ["me", "all"] : ["me"]

  return (
    <div
      className="relative inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-slate-800 p-0.5"
      role="tablist"
      aria-label="Dashboard scope"
    >
      {options.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className="relative flex items-center justify-center rounded-full px-5 py-1.5 text-sm font-semibold transition-colors duration-200 select-none"
        >
          {view === v ? (
            <motion.div
              layoutId="general-dashboard-view-pill"
              className="absolute inset-0 rounded-full bg-white dark:bg-slate-700 shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          ) : null}
          <span className={cn("relative z-10", view === v ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}>
            {v === "me" ? "Me" : "Team"}
          </span>
        </button>
      ))}
    </div>
  )
}
