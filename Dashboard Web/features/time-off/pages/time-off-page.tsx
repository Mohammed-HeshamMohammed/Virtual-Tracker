"use client"

import { Settings } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"

/** Matches integrations “Connect” CTA: `rounded-lg bg-blue-500 … hover:bg-blue-600` */
const integrationPrimaryBtn =
  "rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"

function IllustrationTimeOffPolicy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 180" className={className} fill="none" aria-hidden>
      <ellipse cx="100" cy="168" rx="70" ry="8" className="fill-slate-100 dark:fill-white/5" />
      <circle cx="100" cy="72" r="22" className="fill-amber-200 stroke-amber-300 dark:fill-amber-900/40 dark:stroke-amber-700/50" strokeWidth="2" />
      <path
        d="M88 92c-4 28 8 48 24 52s32-8 36-36"
        className="stroke-sky-600 dark:stroke-sky-400"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="78" y="100" width="44" height="38" rx="6" className="fill-sky-500 dark:fill-sky-600" />
      <path d="M72 118h-8l-6 42h20l-6-42z" className="fill-slate-600 dark:fill-slate-400" />
      <circle cx="58" cy="132" r="6" className="fill-slate-500" />
      <rect x="52" y="136" width="12" height="20" rx="2" className="fill-slate-500" />
    </svg>
  )
}

function IllustrationPublicHoliday({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 180" className={className} fill="none" aria-hidden>
      <ellipse cx="100" cy="168" rx="70" ry="8" className="fill-slate-100 dark:fill-white/5" />
      <path
        d="M100 28 L108 52 L134 52 L114 68 L122 94 L100 78 L78 94 L86 68 L66 52 L92 52 Z"
        className="fill-amber-400 stroke-amber-500 dark:fill-amber-500/90 dark:stroke-amber-400"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M100 52 V120" className="stroke-emerald-700 dark:stroke-emerald-500" strokeWidth="8" strokeLinecap="round" />
      <path d="M72 100c12-8 24-8 56 0" className="stroke-emerald-600 dark:stroke-emerald-500" strokeWidth="6" strokeLinecap="round" fill="none" />
      <circle cx="88" cy="88" r="8" className="fill-red-400" />
      <rect x="112" y="96" width="14" height="12" rx="2" className="fill-amber-300 stroke-amber-500 dark:fill-amber-700/60" strokeWidth="1" />
      <rect x="96" y="108" width="16" height="14" rx="2" className="fill-rose-300 stroke-rose-400 dark:fill-rose-800/50" strokeWidth="1" />
      <rect x="72" y="112" width="14" height="12" rx="2" className="fill-sky-300 stroke-sky-400 dark:fill-sky-800/40" strokeWidth="1" />
    </svg>
  )
}

export function TimeOffRequestsPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()

  return (
    <div className={cn("relative mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
      <div className="mb-10 flex justify-end">
        <button
          type="button"
          onClick={() => onNavigate("settings-all")}
          className={cn(
            "inline-flex items-center gap-2 text-sm font-semibold transition-colors",
            isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-8 lg:gap-12">
        <div
          className={cn(
            "flex flex-col items-center rounded-2xl border px-8 py-10 text-center shadow-sm",
            isDark ? "border-white/10 bg-white/5" : "border-slate-200/80 bg-white"
          )}
        >
          <IllustrationTimeOffPolicy className="mb-8 h-44 w-full max-w-[220px]" />
          <h2 className={cn("text-xl font-bold sm:text-2xl", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Time off policy
          </h2>
          <p className={cn("mt-4 max-w-sm text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            Create a policy for each team member around paid or unpaid time off, vacations, sick days or whatever else you
            offer your team.
          </p>
          <button type="button" className={cn("mt-8", integrationPrimaryBtn)} onClick={() => onNavigate("settings-policies")}>
            Add policy
          </button>
        </div>

        <div
          className={cn(
            "flex flex-col items-center rounded-2xl border px-8 py-10 text-center shadow-sm",
            isDark ? "border-white/10 bg-white/5" : "border-slate-200/80 bg-white"
          )}
        >
          <IllustrationPublicHoliday className="mb-8 h-44 w-full max-w-[220px]" />
          <h2 className={cn("text-xl font-bold sm:text-2xl", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Public holiday
          </h2>
          <p className={cn("mt-4 max-w-sm text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            Add holidays and give your team time off to kick back and relax. You can pay them for that time, too.
          </p>
          <button type="button" className={cn("mt-8", integrationPrimaryBtn)} onClick={() => onNavigate("settings-policies")}>
            Add holiday
          </button>
        </div>
      </div>
    </div>
  )
}

