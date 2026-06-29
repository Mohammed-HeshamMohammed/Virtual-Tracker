"use client"

import { motion } from "framer-motion"
import { Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import type { Task } from "@/features/projects/constants"

export function TaskParticipationChip({
  task,
  isDark,
  compact = false,
}: {
  task: Task
  isDark: boolean
  compact?: boolean
}) {
  const total = task.totalAssignees
  const started = task.startedAssignees
  if (total == null || total <= 1) return null

  const allStarted = task.allAssigneesStarted === true

  const tooltipText = allStarted
    ? `All ${total} assignees have started`
    : `${started ?? 0} of ${total} assignees started (${task.notStartedAssignees ?? 0} remaining)`

  return (
    <IconTooltip text={tooltipText} placement="top" multiline>
      <motion.span
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        allStarted
          ? isDark
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-emerald-50 text-emerald-700"
          : isDark
            ? "bg-blue-500/10 text-blue-300"
            : "bg-blue-50 text-blue-700",
        compact && "px-1.5",
      )}
    >
      <Users className="h-3 w-3 shrink-0 opacity-70" />
      {started ?? 0}/{total}
      {!compact && task.participationPercent != null ? (
        <span className="opacity-70">· {task.participationPercent}%</span>
      ) : null}
      </motion.span>
    </IconTooltip>
  )
}
