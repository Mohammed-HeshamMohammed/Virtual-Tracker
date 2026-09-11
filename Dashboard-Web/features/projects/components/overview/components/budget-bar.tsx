"use client"

import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"

export function fmt$(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`
}

export function fmtBudget(n: number, type: "hours" | "cost" = "cost") {
  if (type === "hours") return Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`
  return fmt$(n)
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
          {fmtBudget(used, type)}
          <span className="text-slate-500 dark:text-[#8f98b8]">/{fmtBudget(total, type)}</span>
        </span>
      )}
    </div>
  )
}
