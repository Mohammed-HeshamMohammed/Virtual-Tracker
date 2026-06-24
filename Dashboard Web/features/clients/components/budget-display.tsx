"use client"

import { BUDGET_TYPES } from "@/features/projects/constants"
import type { Client } from "@/features/clients/models/client"

export function BudgetDisplay({ budget }: { budget: Client["budget"] }) {
  if (!budget || budget.type === "none") return <span className="text-xs text-slate-300">—</span>
  const typeLabel = BUDGET_TYPES.find((t) => t.value === budget.type)?.label ?? budget.type
  return (
    <div>
      <div className="text-sm font-medium text-slate-700">${budget.cost.toLocaleString()}</div>
      <div className="text-xs text-slate-400">
        {typeLabel} · resets {budget.resets}
      </div>
    </div>
  )
}
