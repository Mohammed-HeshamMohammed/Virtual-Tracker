"use client"

import { motion } from "framer-motion"
import { ExternalLink, Wallet } from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"
import { formatUsd0 } from "@/features/dashboard/components/general/shared/format"

export function BudgetsPanel() {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const budgets = viewData?.budgets ?? []

  return (
    <PanelShell
      title="Project budgets"
      subtitle="Utilization across projects"
      icon={<Wallet className="h-5 w-5" />}
      iconClassName="bg-emerald-500"
      loading={loading}
      error={error}
      onRetry={retry}
      empty={!loading && budgets.length === 0}
      emptyMessage="No project budgets configured."
      action={
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          Manage <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <ul className="space-y-4">
        {budgets.map((budget, i) => (
          <li key={budget.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{budget.name}</span>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {formatUsd0(budget.remaining)} left · {formatUsd0(budget.total)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${budget.spentPercent}%` }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className={`h-full rounded-full ${
                  budget.spentPercent >= 90 ? "bg-red-500" : budget.spentPercent >= 75 ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
            </div>
          </li>
        ))}
      </ul>
    </PanelShell>
  )
}
