"use client"

import { useState } from "react"
import { Download, Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { InfoTip } from "@/features/settings/components/policy/components/info-tip"

const BALANCES_TOOLTIP = "This allows managers to edit the time off balances of the members."

function BalancesEmptyIllustration({ isDark }: { isDark: boolean }) {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none" className="mx-auto" aria-hidden>
      <rect x="48" y="28" width="104" height="88" rx="6" className={isDark ? "stroke-white/15 fill-white/3" : "stroke-slate-200 fill-white"} strokeWidth="2" />
      <line x1="56" y1="44" x2="144" y2="44" className={isDark ? "stroke-white/10" : "stroke-slate-100"} strokeWidth="2" />
      <line x1="56" y1="56" x2="120" y2="56" className={isDark ? "stroke-white/10" : "stroke-slate-100"} strokeWidth="2" />
      <line x1="56" y1="68" x2="132" y2="68" className={isDark ? "stroke-white/10" : "stroke-slate-100"} strokeWidth="2" />
      <line x1="56" y1="80" x2="100" y2="80" className={isDark ? "stroke-white/10" : "stroke-slate-100"} strokeWidth="2" />
      <circle cx="100" cy="108" r="22" className={isDark ? "fill-[#2e3447]" : "fill-slate-100"} />
      <text x="100" y="116" textAnchor="middle" className={isDark ? "fill-[#bccbb9]" : "fill-slate-500"} fontSize="22" fontWeight="bold">
        ?
      </text>
      <ellipse cx="100" cy="138" rx="36" ry="5" className={isDark ? "fill-white/5" : "fill-slate-100"} />
      <circle cx="88" cy="96" r="6" className={isDark ? "fill-slate-600" : "fill-slate-300"} />
      <path
        d="M82 118c8 12 20 18 36 18s28-6 36-18"
        className={isDark ? "stroke-white/30" : "stroke-slate-400"}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

export function TimeOffBalancesPanel() {
  const { isDark } = useTheme()
  const [q, setQ] = useState("")

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2
              className={cn(
                "text-[11px] font-bold uppercase tracking-widest",
                isDark ? "text-white/45" : "text-slate-500"
              )}
            >
              Time off balances
            </h2>
            <InfoTip text={BALANCES_TOOLTIP} className={isDark ? "text-white/35 hover:text-white/55" : ""} />
          </div>
          <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
            Set up time off balances for members.
          </p>
        </div>
        <div
          className={cn(
            "flex w-full max-w-xs items-center gap-2 rounded-full border px-4 py-2 lg:w-72 shrink-0",
            isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
          )}
        >
          <Search className={cn("h-4 w-4 shrink-0", isDark ? "text-white/35" : "text-slate-400")} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search members"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm outline-none border-0 focus:ring-0",
              isDark ? "text-[#dce1fb] placeholder:text-white/30" : "text-slate-800 placeholder:text-slate-400"
            )} aria-label="Interactive control"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-4">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 text-sm font-semibold transition-colors",
            isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
          )}
        >
          <Download className="h-4 w-4" />
          Export
        </button>
        <button
          type="button"
          className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
        >
          Import
        </button>
      </div>

      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BalancesEmptyIllustration isDark={isDark} />
        <h3 className={cn("mt-6 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
          No time off balances to show
        </h3>
        <p className={cn("mt-2 max-w-md text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
          Expecting to see something? Try adding members to your policies first.
        </p>
      </div>
    </div>
  )
}

