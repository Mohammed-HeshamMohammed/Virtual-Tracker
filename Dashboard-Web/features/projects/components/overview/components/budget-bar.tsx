/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/only-export-components */
"use client"

import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"

export function fmt$(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`
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

export function BudgetBar({ used, total, type = "cost", mini = false }: BudgetBarProps) {
  const pct = Math.min(Math.round((used / total) * 100), 100)
  const color = pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500"

  return (
    <div className={cn("flex items-center gap-2", mini && "gap-1.5")}>
      <div className={cn("bg-slate-100 rounded-full overflow-hidden", mini ? "w-16 h-1" : "w-24 h-1.5")}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
          className={cn("h-full rounded-full", color)}
        />
      </div>
      {!mini && (
        <span className="text-xs text-slate-500">
          {fmtBudget(used, type)}
          <span className="text-slate-300">/{fmtBudget(total, type)}</span>
        </span>
      )}
    </div>
  )
}
