"use client"

import { CheckSquare, ExternalLink } from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"

export function TodosPanel() {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const todos = viewData?.todos ?? []
  const pending = todos.filter((t) => !t.done).length

  return (
    <PanelShell
      title="Tasks"
      subtitle={`${pending} open`}
      icon={<CheckSquare className="h-5 w-5" />}
      iconClassName="bg-blue-500"
      loading={loading}
      error={error}
      onRetry={retry}
      empty={!loading && todos.length === 0}
      emptyMessage="No open tasks in this view."
      action={
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          View tasks <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <ul className="space-y-1.5">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                todo.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"
              }`}
              aria-hidden
            >
              {todo.done ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${todo.done ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-800 dark:text-slate-100"}`}>
                {todo.title}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              {todo.projectName}
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  )
}
