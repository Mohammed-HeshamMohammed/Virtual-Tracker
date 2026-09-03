import React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { AlertTriangle, Loader2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import type { Member, Priority } from "@/features/projects/constants"
import { PRIORITY_CONFIG } from "@/features/projects/constants"

export function AvatarBubble({ member, size = "sm" }: { member: Member; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-6 h-6 text-[10px]" : "w-7 h-7 text-xs"
  return (
    <IconTooltip text={member.name} placement="top">
      <div
        className={`${dim} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
        style={{ backgroundColor: member.color }}
      >
        {member.avatar}
      </div>
    </IconTooltip>
  )
}

export function PriorityDot({ priority }: { priority: Priority }) {
  return <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_CONFIG[priority].dot}`} />
}
const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-10 w-10 text-sm",
  }

export function MemberAvatar({
  member,
  size = "md",
}: {
  member: { id: string; name: string; avatar: string; color: string }
  size?: "sm" | "md" | "lg"
}) {
  return (
    <IconTooltip text={member.name} placement="top">
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white dark:ring-[#191f31]",
          sizeClasses[size],
        )}
        style={{ backgroundColor: member.color }}
      >
        {member.avatar}
      </div>
    </IconTooltip>
  )
}

export function DeleteConfirmDialog({
  deleteConfirmId,
  onClose,
  onConfirm,
  actionBusy,
  isDark,
  t,
  count,
}: {
  deleteConfirmId: string | null
  onClose: () => void
  onConfirm: (id: string) => void
  actionBusy: boolean
  isDark: boolean
  t: any
  count?: number
}) {
  return (
    <AnimatePresence>
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
          <motion.div
            className={cn(
              "relative z-10 w-full max-w-sm rounded-2xl p-6 shadow-2xl",
              isDark ? "bg-[#1e2538]" : "bg-white",
            )}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className={cn("text-lg font-bold", isDark ? "text-red-400" : "text-red-600")}>
                Delete record?
              </h3>
            </div>
            <p className={cn("mb-6 text-sm leading-relaxed", t.textMuted)}>
              {count && count > 1
                ? `Are you sure you want to delete ${count} projects? This action cannot be undone and any linked data may be removed.`
                : "Are you sure you want to delete this record? This action cannot be undone and any linked data may be removed."}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={actionBusy}
                className={cn(
                  "rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors",
                  isDark ? "hover:bg-white/5 text-white" : "hover:bg-slate-50 text-slate-700",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onConfirm(deleteConfirmId)}
                disabled={actionBusy}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
