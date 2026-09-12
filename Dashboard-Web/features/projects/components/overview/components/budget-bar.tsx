"use client"

import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { formatMoney, useWorkspaceCurrency } from "@/shared/utils/workspace-currency"

/** In the workspace's currency, which is what the figures are already in. */
export function fmtMoney(n: number, currency?: string) {
  return formatMoney(n, currency, { compact: true })
}

export function fmtBudget(n: number, type: "hours" | "cost" = "cost", currency?: string) {
  if (type === "hours") return Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`
  return fmtMoney(n, currency)
}

interface BudgetBarProps {
  used: number
  total: number
  type?: "hours" | "cost"
  mini?: boolean
}

// Themed through the dark: variant rather than an isDark prop, so it reads
// right wherever it is dropped. Colours match overview-theme.ts: the bar
// fills meet 3:1 on both cards, the figures 4.5:1.
export function BudgetBar({ used, total, type = "cost", mini = false }: BudgetBarProps) {
  const currency = useWorkspaceCurrency()
  const pct = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0
  const color =
    pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-600 dark:bg-amber-500" : "bg-emerald-600 dark:bg-emerald-500"

  return (
    <div className={cn("flex items-center gap-2", mini && "gap-1.5")}>
      <div className={cn("bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden", mini ? "w-16 h-1" : "w-24 h-1.5")}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
          className={cn("h-full rounded-full", color)}
        />
      </div>
      {!mini && (
        <span className="text-xs tabular-nums text-slate-700 dark:text-[#aeb7cf]">
          {fmtBudget(used, type, currency)}
          <span className="text-slate-500 dark:text-[#8f98b8]">/{fmtBudget(total, type, currency)}</span>
        </span>
      )}
    </div>
  )
}
