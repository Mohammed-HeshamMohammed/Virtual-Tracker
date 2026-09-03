"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { WORK_BREAK_SIDEBAR, type WorkBreakSidebarKey } from "@/features/settings/components/shared/constants"
import { WorkBreakPoliciesPanel } from "@/features/settings/components/policy/work-breaks/work-break-policies-panel"
import { WorkBreakNotificationsPanel } from "@/features/settings/components/policy/work-breaks/work-break-notifications-panel"

export function WorkBreaksTab() {
  const { isDark } = useTheme()
  const [side, setSide] = useState<WorkBreakSidebarKey>("policies")

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[420px] w-full">
      <aside
        className={cn(
          "lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r pb-2 lg:pb-0 lg:pr-2",
          isDark ? "border-white/10" : "border-slate-200"
        )}
      >
        <nav className="flex lg:flex-col gap-0 overflow-x-auto lg:overflow-visible">
          {WORK_BREAK_SIDEBAR.map(item => {
            const active = side === item.k
            return (
              <button
                key={item.k}
                type="button"
                onClick={() => setSide(item.k)}
                className={cn(
                  "relative px-4 py-3 text-left text-sm font-semibold whitespace-nowrap transition-colors lg:rounded-l-lg border-b-2 lg:border-b-0 border-transparent",
                  active && "border-blue-500 lg:border-transparent",
                  active
                    ? isDark
                      ? "text-blue-400 bg-white/[0.04]"
                      : "text-blue-600 bg-blue-50/80"
                    : isDark
                      ? "text-white/45 hover:text-white/70 hover:bg-white/[0.02]"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full lg:block hidden bg-blue-500" />
                )}
                <span className="lg:pl-2">{item.l}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 pt-4 lg:pt-0 lg:pl-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={side}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="w-full"
          >
            {side === "policies" && <WorkBreakPoliciesPanel />}
            {side === "notifications" && <WorkBreakNotificationsPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

