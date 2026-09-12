"use client"

import { motion } from "framer-motion"
import { DollarSign, ExternalLink } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { OverviewClientRow } from "@/features/projects/mappers/project-mapper"
import { fmtMoney } from "@/features/projects/components/overview/components/budget-bar"
import { useWorkspaceCurrency } from "@/shared/utils/workspace-currency"
import { budgetBarClass, overviewTheme, type Tone } from "@/features/projects/components/overview/overview-theme"

const CLIENT_STATUS: Record<"active" | "archived", { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
}

interface ClientBudgetsProps {
  clients: OverviewClientRow[]
  isDark?: boolean
  onNavigate?: (id: string) => void
}

export function ClientBudgets({ clients, isDark = false, onNavigate }: ClientBudgetsProps) {
  const t = overviewTheme(isDark)
  const currency = useWorkspaceCurrency()
  const activeClients = clients.filter((c) => c.status === "active").slice(0, 6)

  return (
    <div className={cn("rounded-2xl border shadow-sm overflow-hidden min-h-[300px] flex flex-col", t.card)}>
      <div className={cn("flex items-center justify-between px-6 py-4 border-b", t.border)}>
        <div className="flex items-center gap-2">
          <DollarSign className={cn("w-4 h-4", t.icon)} />
          <h3 className={cn("text-sm font-bold", t.title)}>Client Budgets</h3>
        </div>
        <button
          onClick={() => onNavigate?.("pm-clients")}
          className={cn("text-xs font-semibold hover:underline flex items-center gap-1", t.link)}
          type="button"
        >
          Manage <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className={cn("divide-y flex-1 flex flex-col", t.divide)}>
        {activeClients.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
            <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", t.emptyIconWrap)}>
              <DollarSign className={cn("w-6 h-6", t.emptyIcon)} />
            </div>
            <p className={cn("text-sm font-medium", t.text)}>No active clients</p>
            <p className={cn("text-xs mt-1", t.muted)}>Add clients to track their budgets</p>
          </div>
        ) : (
          activeClients.map((c, i) => {
            const projectCount = c.projectIds.length
            const used = c.budgetUsed
            const total = c.budgetTotal
            const pct = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0
            const sCfg = CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS] as { label: string; tone: Tone } | undefined
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                className={cn("px-6 py-4 transition-colors", t.rowHover)}
              >
                <div className="flex items-start justify-between mb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-bold", t.title)}>{c.name}</span>
                      {sCfg && (
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", t.badge[sCfg.tone])}>
                          {sCfg.label}
                        </span>
                      )}
                    </div>
                    <p className={cn("text-xs mt-0.5", t.muted)}>
                      {projectCount} project{projectCount !== 1 ? "s" : ""} · {c.email || "—"}
                    </p>
                  </div>
                  {total > 0 && (
                    <div className="text-right">
                      <p className={cn("text-sm font-bold tabular-nums", pct >= 100 ? t.danger : t.text)}>{fmtMoney(used, currency)}</p>
                      <p className={cn("text-xs tabular-nums", t.muted)}>of {fmtMoney(total, currency)}</p>
                    </div>
                  )}
                </div>
                {total > 0 && (
                  <>
                    <div className={cn("w-full h-1.5 rounded-full overflow-hidden", t.track)}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, delay: 0.15 + i * 0.07 }}
                        className={cn("h-full rounded-full", budgetBarClass(pct, t))}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className={cn("text-[10px] tabular-nums", t.muted)}>{pct}% used</span>
                      <span className={cn("text-[10px] tabular-nums", t.muted)}>
                        {fmtMoney(total - used < 0 ? 0 : total - used, currency)} remaining
                      </span>
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
