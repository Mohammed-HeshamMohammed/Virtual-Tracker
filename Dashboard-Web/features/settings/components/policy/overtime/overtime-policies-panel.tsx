"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { CreateWeeklyOvertimePolicyModal } from "@/features/settings/components/policy/overtime/create-weekly-overtime-policy-modal"

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

function OvertimePoliciesEmptyIllustration({ isDark }: { isDark: boolean }) {
  return (
    <svg width="200" height="168" viewBox="0 0 200 168" fill="none" className="mx-auto" aria-hidden>
      <defs>
        <linearGradient id="otCardGrad" x1="40" y1="32" x2="160" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14b8a6" />
          <stop offset="1" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <rect
        x="36"
        y="40"
        width="128"
        height="100"
        rx="10"
        className={isDark ? "stroke-white/15" : "stroke-slate-200"}
        strokeWidth="2"
        fill={isDark ? "#1a2235" : "#fff"}
      />
      <path d="M36 70h128v70H36z" fill={isDark ? "rgba(255,255,255,0.06)" : "#f1f5f9"} />
      <rect x="36" y="40" width="128" height="34" rx="10" fill="url(#otCardGrad)" />
      <path d="M44 58 L72 48 L96 60 L120 44 L148 58" stroke="white" strokeOpacity="0.35" strokeWidth="2" fill="none" />
      <rect x="48" y="82" width="72" height="5" rx="2" className={isDark ? "fill-white/12" : "fill-slate-200"} />
      <rect x="48" y="92" width="56" height="5" rx="2" className={isDark ? "fill-white/12" : "fill-slate-200"} />
      <rect x="48" y="102" width="64" height="5" rx="2" className={isDark ? "fill-white/12" : "fill-slate-200"} />
      <rect x="48" y="118" width="36" height="10" rx="3" fill="#3b82f6" />
      <g transform="translate(118, 28)">
        <circle cx="28" cy="28" r="26" fill="white" stroke="#3b82f6" strokeWidth="4" />
        <circle cx="28" cy="28" r="22" fill="white" />
        <line x1="28" y1="28" x2="28" y2="16" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="28" y1="28" x2="38" y2="28" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="28" cy="28" r="2" fill="#0f172a" />
      </g>
    </svg>
  )
}

function OvertimePoliciesEmpty({
  tab,
  onAdd,
  isDark,
}: {
  tab: "active" | "archived"
  onAdd: () => void
  isDark: boolean
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center lg:py-6">
      <OvertimePoliciesEmptyIllustration isDark={isDark} />
      <p className={cn("mt-6 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
        No {tab} overtime policies
      </p>
      <p className={cn("mt-2 max-w-sm text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        Set up automatic overtime policies
      </p>
      {tab === "active" && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-6 rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
        >
          Add policy
        </button>
      )}
    </div>
  )
}

export function OvertimePoliciesPanel() {
  const { isDark } = useTheme()
  const [sub, setSub] = useState<"active" | "archived">("active")
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="w-full">
      <PoliciesTabBar active={sub} onChange={setSub} isDark={isDark} />

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        <div className="shrink-0 lg:max-w-xs">
          <h2
            className={cn(
              "text-[11px] font-bold uppercase tracking-widest",
              isDark ? "text-white/45" : "text-slate-500"
            )}
          >
            Overtime policies
          </h2>
          <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
            Set up automatic overtime policies
          </p>
        </div>

        <div className="min-h-[280px] flex-1 min-w-0">
          <OvertimePoliciesEmpty tab={sub} onAdd={() => setShowModal(true)} isDark={isDark} />
        </div>
      </div>

      <AnimatePresence>
        {showModal && <CreateWeeklyOvertimePolicyModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  )
}

