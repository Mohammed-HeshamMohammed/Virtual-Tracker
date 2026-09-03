"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IntegrationConnectCard } from "@/features/settings/components/integrations/components/integration-connect-card"

export interface PmIntegrationItem {
  id: string
  name: string
  logo: ReactNode
}

function LogoDot({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "h-12 w-12 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-inner",
        className
      )}
    >
      {children}
    </div>
  )
}

const PM_INTEGRATIONS_ROW_A: PmIntegrationItem[] = [
  { id: "asana", name: "Asana", logo: <LogoDot className="bg-[#F06A6A]">A</LogoDot> },
  { id: "breeze", name: "Breeze", logo: <LogoDot className="bg-gradient-to-br from-pink-400 to-blue-500">B</LogoDot> },
  { id: "clickup", name: "ClickUp", logo: <LogoDot className="bg-[#7B68EE]">▲</LogoDot> },
  { id: "github", name: "GitHub", logo: <LogoDot className="bg-[#24292f]">GH</LogoDot> },
  { id: "insightly", name: "Insightly", logo: <LogoDot className="bg-[#f26522] text-white">in</LogoDot> },
  { id: "jira", name: "Jira", logo: <LogoDot className="bg-[#0052CC]">J</LogoDot> },
  { id: "liquidplanner", name: "LiquidPlanner", logo: <LogoDot className="bg-slate-500">≋</LogoDot> },
  { id: "mavenlink", name: "Mavenlink", logo: <LogoDot className="bg-[#0066cc]">M</LogoDot> },
]

const PM_INTEGRATIONS_ROW_B: PmIntegrationItem[] = [
  { id: "monday", name: "Monday", logo: <LogoDot className="bg-[#ff3d57]">M</LogoDot> },
  { id: "paymo", name: "Paymo", logo: <LogoDot className="bg-black">P</LogoDot> },
  { id: "podio", name: "Podio", logo: <LogoDot className="bg-[#2969b0]">◎</LogoDot> },
  { id: "redbooth", name: "Redbooth", logo: <LogoDot className="bg-[#e74c3c]">R</LogoDot> },
  { id: "redmine", name: "Redmine", logo: <LogoDot className="bg-[#b32024]">Rm</LogoDot> },
  { id: "teamwork", name: "Teamwork", logo: <LogoDot className="bg-[#1f2937]">T</LogoDot> },
  { id: "trello", name: "Trello", logo: <LogoDot className="bg-[#0079bf]">T</LogoDot> },
  { id: "unfuddle", name: "Unfuddle", logo: <LogoDot className="bg-black">U</LogoDot> },
  { id: "zoho", name: "Zoho Projects", logo: <LogoDot className="bg-gradient-to-br from-red-500 via-green-500 to-blue-600">Z</LogoDot> },
  { id: "activecollab", name: "activeCollab", logo: <LogoDot className="bg-[#1a1a1a]">a</LogoDot> },
  { id: "gitlab", name: "GitLab", logo: <LogoDot className="bg-[#FC6D26]">G</LogoDot> },
]

export function ProjectManagementIntegrationsSection({ isDark }: { isDark: boolean }) {
  const [query, setQuery] = useState("")

  const filteredA = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PM_INTEGRATIONS_ROW_A
    return PM_INTEGRATIONS_ROW_A.filter(i => i.name.toLowerCase().includes(q))
  }, [query])

  const filteredB = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PM_INTEGRATIONS_ROW_B
    return PM_INTEGRATIONS_ROW_B.filter(i => i.name.toLowerCase().includes(q))
  }, [query])

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={cn("text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Project management</h2>
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-4 py-2 w-full sm:max-w-xs",
            isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
          )}
        >
          <Search className={cn("w-4 h-4 shrink-0", isDark ? "text-white/40" : "text-slate-400")} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search integrations"
            className={cn(
              "w-full bg-transparent text-sm outline-none border-0 focus:ring-0",
              isDark ? "text-[#dce1fb] placeholder:text-white/35" : "text-slate-800 placeholder:text-slate-400"
            )} aria-label="Interactive control"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredA.map(item => (
          <IntegrationConnectCard key={item.id} name={item.name} logo={item.logo} href="#" />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
        {filteredB.map(item => (
          <IntegrationConnectCard key={item.id} name={item.name} logo={item.logo} href="#" />
        ))}
      </div>
    </section>
  )
}

