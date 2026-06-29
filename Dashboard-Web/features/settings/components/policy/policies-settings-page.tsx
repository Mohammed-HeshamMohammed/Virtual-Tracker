/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { POLICY_MAIN_TABS, type PolicyMainTabKey } from "@/features/settings/components/shared/constants"
import { TimeOffTab } from "@/features/settings/components/policy/sections/time-off-tab"
import { WorkBreaksTab } from "@/features/settings/components/policy/sections/work-breaks-tab"
import { OvertimeTab } from "@/features/settings/components/policy/sections/overtime-tab"

export function PoliciesSettingsPage() {
  const { isDark } = useTheme()
  const [tab, setTab] = useState<PolicyMainTabKey>("timeoff")

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div
        className={cn(
          "shrink-0 border-b w-full overflow-x-auto flex scrollbar-none",
          isDark ? "border-white/5" : "border-slate-200"
        )}
      >
        {POLICY_MAIN_TABS.map(t => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn(
              "px-5 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 whitespace-nowrap transition-colors shrink-0",
              tab === t.k
                ? "text-blue-500 border-blue-500"
                : isDark
                  ? "text-white/30 border-transparent hover:text-white/55"
                  : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide pt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full"
          >
            {tab === "timeoff" && <TimeOffTab />}
            {tab === "breaks" && <WorkBreaksTab />}
            {tab === "overtime" && <OvertimeTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

