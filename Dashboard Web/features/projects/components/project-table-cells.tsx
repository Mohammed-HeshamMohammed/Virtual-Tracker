/* eslint-disable react-doctor/only-export-components */
"use client"

import { cn } from "@/shared/utils/utils"

export function formatProjectBudget(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n}`
}

export function BudgetBar({ spent, total, isDark = false }: { spent: number; total: number; isDark?: boolean }) {
  const pct = Math.min(Math.round((spent / total) * 100), 100)
  const color = pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400"
  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-1.5 w-16 overflow-hidden rounded-full", isDark ? "bg-[#2e3447]" : "bg-slate-100")}>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        {formatProjectBudget(spent)}
        <span className={isDark ? "text-[#3d4a3d]" : "text-slate-300"}>/{formatProjectBudget(total)}</span>
      </span>
    </div>
  )
}

export function TodoProgress({ done, total, isDark }: { done: number; total: number; isDark: boolean }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const all = pct === 100
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "text-xs font-medium",
          all ? (isDark ? "text-[#4be277]" : "text-emerald-600") : isDark ? "text-[#dce1fb]" : "text-slate-600",
        )}
      >
        {done}
        <span className={cn("font-normal", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>/{total}</span>
      </span>
      {all ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            isDark ? "bg-[#4be277]/15 text-[#4be277]" : "bg-emerald-50 text-emerald-600",
          )}
        >
          Done
        </span>
      ) : null}
    </div>
  )
}

export function MemberLimit({ members, limit, isDark }: { members: number; limit: number | null; isDark: boolean }) {
  if (limit === null) return <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-400")}>—</span>
  const atLimit = members >= limit
  return (
    <span className={cn("text-xs font-medium", atLimit ? "text-red-500" : isDark ? "text-[#dce1fb]" : "text-slate-600")}>
      {members}
      <span className={isDark ? "text-[#3d4a3d]" : "text-slate-300"}>/{limit}</span>
    </span>
  )
}

export function TeamBadge({ name, isDark }: { name: string; isDark: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-500",
      )}
    >
      {name}
    </span>
  )
}
