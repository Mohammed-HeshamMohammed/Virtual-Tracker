/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { AddPolicyModal } from "@/features/settings/components/policy/time-off/time-off-policy-wizard"

type AccrualSchedule = "None" | "Annual" | "Monthly" | "Hours worked" | "Policy joined date"
type PaidStatus = "Paid" | "Unpaid"

interface PolicyRowData {
  id: string
  name: string
  accrual: AccrualSchedule
  paid: PaidStatus
  members: number
}

function PoliciesTabBar({
  active,
  onChange,
  isDark,
}: {
  active: "active" | "archived"
  onChange: (t: "active" | "archived") => void
  isDark: boolean
}) {
  return (
    <div className={cn("flex border-b mb-6", isDark ? "border-white/10" : "border-slate-200")}>
      {(["active", "archived"] as const).map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            "px-5 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors",
            active === tab
              ? "border-blue-500 text-blue-500"
              : isDark
                ? "border-transparent text-white/35 hover:text-white/55"
                : "border-transparent text-slate-400 hover:text-slate-600"
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function PoliciesEmptyState({
  tab,
  onAdd,
  isDark,
}: {
  tab: "active" | "archived"
  onAdd: () => void
  isDark: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <svg width="120" height="130" viewBox="0 0 120 130" fill="none" aria-hidden className="opacity-90">
        <ellipse cx="60" cy="118" rx="40" ry="6" className={isDark ? "fill-white/5" : "fill-slate-100"} />
        <rect x="30" y="20" width="60" height="78" rx="8" className={isDark ? "fill-white/10" : "fill-slate-200"} />
        <rect x="36" y="30" width="48" height="6" rx="3" className={isDark ? "fill-white/15" : "fill-slate-300"} />
        <rect x="36" y="42" width="32" height="5" rx="2.5" className={isDark ? "fill-white/15" : "fill-slate-300"} />
        <rect x="36" y="53" width="40" height="5" rx="2.5" className={isDark ? "fill-white/15" : "fill-slate-300"} />
        <circle cx="80" cy="65" r="20" fill="#3b82f6" />
        <path
          d="M80 56v9l5 3"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className={cn("text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
        No {tab} time off policies
      </p>
      <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        Set up automatic accrual policies for time off
      </p>
      {tab === "active" && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-1 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Add policy
        </button>
      )}
    </div>
  )
}

function PolicyRow({
  policy,
  onArchive,
  isDark,
}: {
  policy: PolicyRowData
  onArchive: (id: string) => void
  isDark: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4 px-5 py-4 rounded-xl border transition-all group",
        isDark ? "border-white/10 hover:border-white/20 bg-[#151b2d]/40" : "border-slate-200 hover:border-slate-300 bg-white"
      )}
    >
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{policy.name}</p>
        <p className={cn("text-xs mt-0.5", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
          {policy.accrual} · {policy.paid}
        </p>
      </div>
      <span className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        {policy.members} member{policy.members !== 1 ? "s" : ""}
      </span>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        Active
      </span>
      <button
        type="button"
        onClick={() => onArchive(policy.id)}
        className={cn(
          "opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs border rounded-lg transition-all",
          isDark
            ? "border-white/10 text-[#bccbb9] hover:bg-white/5"
            : "border-slate-200 text-slate-600 hover:bg-slate-50"
        )}
      >
        Archive
      </button>
    </div>
  )
}

export function TimeOffPoliciesPanel() {
  const { isDark } = useTheme()
  const [tab, setTab] = useState<"active" | "archived">("active")
  const [showModal, setShowModal] = useState(false)
  const [policies, setPolicies] = useState<PolicyRowData[]>([])

  const archive = (id: string) => setPolicies(p => p.filter(x => x.id !== id))

  return (
    <div className="w-full">
      <PoliciesTabBar active={tab} onChange={setTab} isDark={isDark} />

      {policies.length === 0 ? (
        <PoliciesEmptyState tab={tab} onAdd={() => setShowModal(true)} isDark={isDark} />
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Add policy
            </button>
          </div>
          {policies.map(p => (
            <PolicyRow key={p.id} policy={p} onArchive={archive} isDark={isDark} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && <AddPolicyModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  )
}

