"use client"

import { motion } from "framer-motion"
import type { OnlineMember } from "@/features/dashboard/components/general/constants"

const statusColor = {
  Working: "bg-emerald-500",
  Idle: "bg-amber-500",
  Offline: "bg-slate-400",
} as const

export function MemberRow({
  member,
  onSelect,
}: {
  member: OnlineMember
  onSelect: () => void
}) {
  return (
    <motion.li whileHover={{ x: 2 }}>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
      >
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-200">
            {member.initials}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-900 ${statusColor[member.status]}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{member.name}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {member.status === "Working" ? member.project || "Working" : member.lastActive}
          </p>
        </div>
        {member.time && member.status === "Working" ? (
          <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">{member.time}</span>
        ) : null}
      </button>
    </motion.li>
  )
}
