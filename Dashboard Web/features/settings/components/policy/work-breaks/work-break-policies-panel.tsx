"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { AddWorkBreakPolicyModal } from "@/features/settings/components/policy/work-breaks/add-work-break-policy-modal"

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

function WorkBreakPoliciesEmpty({ tab, onAdd, isDark }: { tab: "active" | "archived"; onAdd: () => void; isDark: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <svg width="140" height="150" viewBox="0 0 140 150" fill="none" aria-hidden className="opacity-95">
        <ellipse cx="70" cy="132" rx="48" ry="7" className={isDark ? "fill-white/5" : "fill-slate-100"} />
        <rect x="52" y="38" width="56" height="72" rx="6" className={isDark ? "fill-white/10 stroke-white/15" : "fill-slate-100 stroke-slate-200"} strokeWidth="2" />
        <rect x="58" y="48" width="44" height="8" rx="2" className={isDark ? "fill-white/12" : "fill-slate-200"} />
        <rect x="58" y="62" width="36" height="6" rx="2" className={isDark ? "fill-white/12" : "fill-slate-200"} />
        <circle cx="62" cy="98" r="14" className={isDark ? "fill-violet-400/80" : "fill-violet-400"} />
        <path
          d="M52 118c6 14 18 22 36 22s30-8 36-22"
          className={isDark ? "stroke-blue-400/90" : "stroke-blue-500"}
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="78" y="88" width="28" height="36" rx="4" className={isDark ? "fill-blue-500/90" : "fill-blue-500"} />
      </svg>
      <p className={cn("text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
        No {tab} work break policies
      </p>
      <p className={cn("text-sm max-w-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        Set up automatic work break policies
      </p>
      {tab === "active" && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
        >
          Add policy
        </button>
      )}
    </div>
  )
}

export function WorkBreakPoliciesPanel() {
  const { isDark } = useTheme()
  const [sub, setSub] = useState<"active" | "archived">("active")
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="w-full">
      <PoliciesTabBar active={sub} onChange={setSub} isDark={isDark} />
      <WorkBreakPoliciesEmpty tab={sub} onAdd={() => setShowModal(true)} isDark={isDark} />
      <AnimatePresence>
        {showModal && <AddWorkBreakPolicyModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  )
}

