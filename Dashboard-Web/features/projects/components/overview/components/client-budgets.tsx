"use client"

import { motion } from "framer-motion"
import { DollarSign, ExternalLink } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewClientRow } from "@/features/projects/mappers/project-mapper"
import { fmt$ } from "@/features/projects/components/overview/components/budget-bar"

const CLIENT_STATUS = {
  active: { label: "Active", color: "text-emerald-600", bg: "bg-emerald-50" },
  archived: { label: "Archived", color: "text-slate-400", bg: "bg-slate-100" },
}

interface ClientBudgetsProps {
  clients: OverviewClientRow[]
  isDark?: boolean
  onNavigate?: (id: string) => void
}

export function ClientBudgets({ clients, isDark = false, onNavigate }: ClientBudgetsProps) {
  const activeClients = clients.filter((c) => c.status === "active").slice(0, 6)

  return (
    <div
      className={cn(
        "rounded-2xl border shadow-sm overflow-hidden min-h-[300px] flex flex-col",
        isDark ? "bg-[#0c1324] border-[#3d4a3d]/40" : "bg-white border-slate-100",
      )}
    >
      <div className={cn("flex items-center justify-between px-6 py-4 border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">Client Budgets</h3>
        </div>
        <button
          onClick={() => onNavigate?.("pm-clients")}
          className="text-xs text-green-700 font-semibold hover:underline flex items-center gap-1" type="button"
        >
          Manage <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="divide-y divide-slate-50 flex-1 flex flex-col">
        {activeClients.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
            <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", isDark ? "bg-[#191f31]" : "bg-slate-100")}>
              <DollarSign className={cn("w-6 h-6", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
            </div>
            <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>No active clients</p>
            <p className={cn("text-xs text-slate-400 mt-1")}>Add clients to track their budgets</p>
          </div>
        ) : (
          activeClients.map((c, i) => {
            const projectCount = c.projectIds.length
            const used = c.budgetUsed
            const total = c.budgetTotal
            const pct = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0
            const sCfg = CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS]
            const barColor = pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500"
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                className="px-6 py-4 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex items-start justify-between mb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">{c.name}</span>
                      {sCfg && (
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", sCfg.color, sCfg.bg)}>
                          {sCfg.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {projectCount} project{projectCount !== 1 ? "s" : ""} · {c.email || "—"}
                    </p>
                  </div>
                  {total > 0 && (
                    <div className="text-right">
                      <p className={cn("text-sm font-bold", pct >= 100 ? "text-red-500" : "text-slate-700")}>{fmt$(used)}</p>
                      <p className="text-xs text-slate-400">of {fmt$(total)}</p>
                    </div>
                  )}
                </div>
                {total > 0 && (
                  <>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, delay: 0.15 + i * 0.07 }}
                        className={cn("h-full rounded-full", barColor)}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className="text-[10px] text-slate-400">{pct}% used</span>
                      <span className="text-[10px] text-slate-400">{fmt$(total - used < 0 ? 0 : total - used)} remaining</span>
                    </div>
                  </>
                )}
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}
