"use client"

import { cn } from "@/shared/utils/utils"
import { describeProjectRules, type ProjectRules, type RuleChip } from "@/features/projects/utils/project-rules"
import { formatMoney, useWorkspaceCurrency } from "@/shared/utils/workspace-currency"

export function formatHoursLabel(totalHours: number): string {
  if (!(totalHours > 0)) return "0h"
  const totalMinutes = Math.round(totalHours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** Money is in the workspace's currency - the backend converted it there. */
export function formatProjectBudget(n: number, type: "hours" | "cost" = "cost", currency?: string) {
  if (type === "hours") return formatHoursLabel(n)
  return formatMoney(n, currency, { compact: true })
}

export function BudgetBar({
  spent,
  total,
  type = "cost",
  isDark = false,
}: {
  spent: number
  total: number
  type?: "hours" | "cost"
  isDark?: boolean
}) {
  const currency = useWorkspaceCurrency()
  const pct = Math.min(Math.round((spent / total) * 100), 100)
  const color = pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400"
  const displaySpent = type === "hours" ? Math.min(spent, total) : spent
  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-1.5 w-16 overflow-hidden rounded-full", isDark ? "bg-[#2e3447]" : "bg-slate-100")}>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        {formatProjectBudget(displaySpent, type, currency)}
        <span className={isDark ? "text-[#3d4a3d]" : "text-slate-300"}>/{formatProjectBudget(total, type, currency)}</span>
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

const RULE_CHIP_TONE: Record<RuleChip["tone"], { light: string; dark: string }> = {
  warn: { light: "bg-amber-50 text-amber-700", dark: "bg-amber-500/15 text-amber-300" },
  info: { light: "bg-blue-50 text-blue-600", dark: "bg-[#4be277]/10 text-[#4be277]" },
  muted: { light: "bg-slate-100 text-slate-500", dark: "bg-[#2e3447] text-[#bccbb9]" },
}

const VISIBLE_RULE_CHIPS = 2

/** The project's Management tab switches as chips. The first two show; the rest are in the tooltip. */
export function ProjectRulesCell({
  rules,
  hasTasks,
  isDark,
}: {
  rules: ProjectRules | undefined
  hasTasks: boolean
  isDark: boolean
}) {
  if (!rules) return <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>—</span>
  const chips = describeProjectRules(rules, { hasTasks })
  if (chips.length === 0) return <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>—</span>
  const shown = chips.slice(0, VISIBLE_RULE_CHIPS)
  const hidden = chips.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1" title={chips.map((chip) => `${chip.label} - ${chip.detail}`).join("\n")}>
      {shown.map((chip) => (
        <span
          key={chip.key}
          className={cn(
            "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium",
            isDark ? RULE_CHIP_TONE[chip.tone].dark : RULE_CHIP_TONE[chip.tone].light,
          )}
        >
          {chip.label}
        </span>
      ))}
      {hidden > 0 ? (
        <span className={cn("text-[10px] font-medium", isDark ? "text-[#bccbb9]" : "text-slate-400")}>+{hidden}</span>
      ) : null}
    </div>
  )
}
