/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import CompanyInformation from "@/features/settings/components/organization/sections/company-information"
import SecurityLogin from "@/features/settings/components/organization/sections/security-login"
import ProjectsTodos from "@/features/settings/components/organization/sections/projects-todos"
import Permissions from "@/features/settings/components/organization/sections/permissions"
import { ORGANIZATION_TABS, type OrganizationTabKey } from "@/features/settings/components/shared/constants"

export default function OrganizationSettingsPage({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { isDark } = useTheme()
  const [tab, setTab] = useState("company")

  return (
    <div className="pt-1 w-full max-w-none">
      <div className={cn("border-b w-full overflow-x-auto flex", isDark ? "border-white/5" : "border-slate-100")}>
        {ORGANIZATION_TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={cn(
            "px-6 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 whitespace-nowrap transition-colors",
            tab === t.k
              ? "text-[#006e2f] border-[#006e2f]"
              : isDark ? "text-white/30 border-transparent hover:text-white/60" : "text-slate-400 border-transparent hover:text-slate-600"
          )} type="button">
            {t.l}
          </button>
        ))}
      </div>
      <div className="min-h-[500px] w-full pt-2">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="w-full">
            {tab === "company" && <CompanyInformation />}
            {tab === "security" && <SecurityLogin />}
            {tab === "projects" && <ProjectsTodos />}
            {tab === "permissions" && <Permissions />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

