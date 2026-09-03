"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import CustomFields from "@/features/settings/components/members/sections/custom-fields"
import WorkTimeLimits from "@/features/settings/components/members/sections/work-time-limits"
import Payments from "@/features/settings/components/members/sections/payments"
import { MEMBERS_TABS, type MembersTabKey } from "@/features/settings/components/shared/constants"

export default function MembersSettings({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const [tab, setTab] = useState("custom")

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("vt-settings-members-pending")
      if (!raw) return
      const p = JSON.parse(raw) as { tab?: MembersTabKey }
      if (p.tab === "custom" || p.tab === "worklimits" || p.tab === "payments") {
        setTab(p.tab)
      }
      sessionStorage.removeItem("vt-settings-members-pending")
    } catch {
      sessionStorage.removeItem("vt-settings-members-pending")
    }
  }, [])

  return (
    <div className="flex flex-col h-full w-full">
      <div className={cn("border-b w-full overflow-x-auto flex shrink-0", isDark ? "border-white/5" : "border-slate-100")}>
        {MEMBERS_TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={cn("px-6 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 whitespace-nowrap transition-colors",
              tab === t.k
                ? "text-blue-500 border-blue-500"
                : isDark ? "text-white/30 border-transparent hover:text-white/60" : "text-slate-400 border-transparent hover:text-slate-600"
            )} type="button">
            {t.l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pt-6 min-h-0 scrollbar-hide">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === "custom" && <CustomFields />}
            {tab === "worklimits" && <WorkTimeLimits />}
            {tab === "payments" && <Payments onNavigate={onNavigate} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

