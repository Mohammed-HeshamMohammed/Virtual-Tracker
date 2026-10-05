"use client"

import { motion } from "framer-motion"
import { AlertTriangle, Clock3, Gauge, UsersRound } from "lucide-react"
import type { NavigateHandler } from "@/app/routes/types"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface TeamUtilizationSectionProps {
  project: ProjectData
  onNavigate?: NavigateHandler
}

function hoursLabel(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`
}

export function TeamUtilizationSection({ project: d, onNavigate }: TeamUtilizationSectionProps) {
  const configuredLabel = `${d.utilizationCounted} of ${d.utilizationTotalMembers}`
  const attentionCount = d.utilizationMembers.over + d.utilizationMembers.under
  const metrics = [
    { icon: Clock3, label: "Tracked", value: hoursLabel(d.utilizationTrackedHours), hint: "All members this week" },
    {
      icon: Gauge,
      label: "Capacity",
      value: d.utilizationCounted > 0 ? hoursLabel(d.utilizationCapacityHours) : "Not set",
      hint: "Configured weekly limits",
    },
    {
      icon: UsersRound,
      label: "Coverage",
      value: configuredLabel,
      hint: `${d.utilizationCoveragePercent}% have a limit`,
    },
  ]

  return (
    <SectionCard
      help="Member utilization: tracked hours compared with configured weekly limits. The percentage is weighted by each member's actual capacity."
      className="flex flex-col"
    >
      <div className="mb-5">
        <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Member Utilization</h3>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          This week · tracked hours compared with member limits
        </p>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        {metrics.map(({ icon: Icon, label, value, hint }) => (
          <div
            key={label}
            className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/45"
          >
            <div className="mb-2 flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </div>
            <div className="truncate text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500">{hint}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex items-center gap-5 rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
        <div className="relative h-28 w-28 shrink-0">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="40" fill="transparent" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="10" />
            <motion.circle
              cx="50"
              cy="50"
              r="40"
              fill="transparent"
              className={
                d.utilizationPercent > 100
                  ? "stroke-rose-500 dark:stroke-rose-400"
                  : d.utilizationPercent < 60
                    ? "stroke-amber-400 dark:stroke-amber-500"
                    : "stroke-emerald-500 dark:stroke-emerald-400"
              }
              strokeWidth="10"
              strokeDasharray="251.2"
              strokeLinecap="round"
              initial={{ strokeDashoffset: 251.2 }}
              animate={{ strokeDashoffset: d.utilizationOffset }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {d.utilizationCounted > 0 ? (
              <>
                <motion.span
                  key={`${d.id}-util`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100"
                >
                  {d.utilizationPercent}%
                </motion.span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Used</span>
              </>
            ) : (
              <span className="px-4 text-center text-[10px] font-semibold leading-tight text-slate-400 dark:text-slate-500">
                Limits not configured
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          {[
            { dot: "bg-emerald-500", label: "Healthy · 60–100%", value: d.utilizationMembers.onTrack },
            { dot: "bg-rose-500", label: "Over limit", value: d.utilizationMembers.over },
            { dot: "bg-amber-400", label: "Below 60%", value: d.utilizationMembers.under },
            { dot: "bg-slate-300 dark:bg-slate-600", label: "Limit missing", value: d.utilizationMembers.noLimit },
          ].map((row, index) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${row.dot}`} />
                <span className="truncate font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
              </div>
              <motion.span
                key={`${d.id}-util-${row.label}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.08 }}
                className="font-bold tabular-nums text-slate-900 dark:text-slate-100"
              >
                {row.value}
              </motion.span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {attentionCount > 0
            ? `${attentionCount} ${attentionCount === 1 ? "member needs" : "members need"} workload review.`
            : d.utilizationMembers.noLimit > 0
              ? `${d.utilizationMembers.noLimit} ${d.utilizationMembers.noLimit === 1 ? "member needs" : "members need"} a weekly limit.`
              : "Every configured member is within the healthy range."}
        </span>
      </div>

      <button
        onClick={() => onNavigate?.("people-members")}
        className="mt-auto w-full rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-900 shadow-sm transition-all hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
        type="button"
      >
        Manage Member Limits
      </button>
    </SectionCard>
  )
}
