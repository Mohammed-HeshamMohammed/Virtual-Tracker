"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { WORK_BREAK_NOTIFICATION_MEMBERS } from "@/features/settings/components/shared/constants"
import { InfoTip } from "@/features/settings/components/policy/components/info-tip"

const HEADER_TOOLTIP =
  "When enabled, owners and managers can receive alerts when overtime thresholds are approached or exceeded."

const GLOBAL_TOOLTIP = "Organization default. This is what all current and future members will be set to."

export function OvertimeNotificationsPanel() {
  const { isDark } = useTheme()
  const [q, setQ] = useState("")
  const [globalOn, setGlobalOn] = useState(true)
  const [memberOn, setMemberOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(WORK_BREAK_NOTIFICATION_MEMBERS.map(m => [m.id, true]))
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return [...WORK_BREAK_NOTIFICATION_MEMBERS]
    return WORK_BREAK_NOTIFICATION_MEMBERS.filter(m => m.name.toLowerCase().includes(s))
  }, [q])

  return (
    <div className="w-full space-y-8">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2
            className={cn(
              "text-[11px] font-bold uppercase tracking-widest",
              isDark ? "text-white/45" : "text-slate-500"
            )}
          >
            Overtime notifications
          </h2>
          <InfoTip text={HEADER_TOOLTIP} className={isDark ? "text-white/35 hover:text-white/55" : ""} />
        </div>
        <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
          Notify team members and management about overtime
        </p>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4",
          isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-slate-50/50"
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-bold uppercase tracking-wide", isDark ? "text-white/55" : "text-slate-600")}>
            Global:
          </span>
          <InfoTip text={GLOBAL_TOOLTIP} className={isDark ? "text-white/35 hover:text-white/55" : ""} />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={globalOn}
          onClick={() => setGlobalOn(v => !v)}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
            globalOn ? "bg-blue-500" : isDark ? "bg-white/15" : "bg-slate-200"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform",
              globalOn ? "left-5" : "left-0.5"
            )}
          >
            {globalOn && (
              <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
        </button>
      </div>

      <div>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Individual settings</h3>
            <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              Override the organization default for specific members.
            </p>
          </div>
          <div
            className={cn(
              "flex w-full max-w-xs items-center gap-2 rounded-full border px-4 py-2 sm:w-72 shrink-0",
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

        <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
          <div
            className={cn(
              "grid grid-cols-[1fr_auto] gap-2 border-b px-4 py-3 text-left text-xs font-bold uppercase tracking-wider",
              isDark ? "border-white/10 bg-white/[0.03] text-white/45" : "border-slate-100 bg-slate-50 text-slate-500"
            )}
          >
            <span>Name</span>
            <span className="sr-only">Enabled</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {filtered.map(m => (
              <li
                key={m.id}
                className={cn("grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3", isDark ? "bg-transparent" : "bg-white")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("h-9 w-9 shrink-0 rounded-full", m.hue)} aria-hidden />
                  <span className={cn("truncate text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                    {m.name}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={memberOn[m.id] ?? false}
                  onClick={() => setMemberOn(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors justify-self-end",
                    memberOn[m.id] ? "bg-blue-500" : isDark ? "bg-white/15" : "bg-slate-200"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform",
                      memberOn[m.id] ? "left-5" : "left-0.5"
                    )}
                  >
                    {memberOn[m.id] && (
                      <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p
            className={cn(
              "border-t px-4 py-3 text-center text-xs",
              isDark ? "border-white/10 text-white/40" : "border-slate-100 text-slate-500"
            )}
          >
            Showing {filtered.length} of {WORK_BREAK_NOTIFICATION_MEMBERS.length} members
          </p>
        </div>
      </div>
    </div>
  )
}

