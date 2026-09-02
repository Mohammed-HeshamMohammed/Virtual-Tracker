/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useEffect, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Upload } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { BatchEditAction } from "@/features/members/components/modals/batch-edit-modal"

/** Owner/Super Admin/Admin/Super Manager only - server enforces this too
 *  (updateMemberProfile's hasPayBill branch, every payBill write including
 *  batch-update funnels through it), so without this a Manager could pick
 *  "Edit pay rate", fill in a value, and only find out it was refused after
 *  submitting. */
const PAY_RATE_ACTIONS = new Set<BatchEditAction>(["payRate", "billRate", "payPeriod"])

const groups: {
  label: string | null
  items: { label: string; icon?: ReactNode; danger?: boolean; action: BatchEditAction | "import" }[]
}[] = [
  { label: null, items: [{ label: "Import list to bulk update", icon: <Upload className="w-3.5 h-3.5" />, action: "import" }] },
  {
    label: "BATCH EDIT MEMBERS",
    items: [
      { label: "Edit pay rate", action: "payRate" },
      { label: "Edit bill rate", action: "billRate" },
      { label: "Edit pay period", action: "payPeriod" },
      { label: "Work time & limits", action: "workTimeLimits" },
      { label: "Remove from tree", danger: true, action: "removeFromTree" },
      { label: "Remove member", danger: true, action: "remove" },
    ],
  },
]

export function BatchActionsDropdown({
  disabled,
  selectedIds,
  onOpenAction,
  onImportClick,
  isDark = false,
  canEditPayRate = true,
}: {
  disabled: boolean
  selectedIds: string[]
  onOpenAction: (action: BatchEditAction) => void
  onImportClick?: () => void
  isDark?: boolean
  canEditPayRate?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedCount = selectedIds.length
  const visibleGroups = canEditPayRate
    ? groups
    : groups.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.action === "import" || !PAY_RATE_ACTIONS.has(item.action as BatchEditAction)),
      }))

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors",
          isDark
            ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          disabled ? "cursor-not-allowed opacity-50" : "",
        )}
      >
        Batch actions
        {selectedCount > 0 && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              isDark ? "bg-[#4be277]/20 text-[#4be277]" : "bg-blue-100 text-blue-700",
            )}
          >
            {selectedCount}
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4", isDark ? "text-[#bccbb9]" : "text-slate-500")} />
      </button>
      <AnimatePresence>
        {open && !disabled && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.currentTarget.click()
                }
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute left-0 top-10 z-20 w-56 rounded-xl border py-2 shadow-lg",
                isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-100 bg-white",
              )}
            >
              {visibleGroups.map((group, gi) => (
                <div key={gi}>
                  {group.label && (
                    <div
                      className={cn(
                        "px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider",
                        isDark ? "text-[#bccbb9]/60" : "text-slate-400",
                      )}
                    >
                      {group.label}
                    </div>
                  )}
                  {gi > 0 && <div className={cn("my-1 border-t", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")} />}
                  {group.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        if (item.action === "import") {
                          onImportClick?.()
                          return
                        }
                        onOpenAction(item.action)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors",
                        item.danger
                          ? isDark
                            ? "text-red-400 hover:bg-red-400/10"
                            : "text-red-500 hover:bg-red-50"
                          : isDark
                            ? "text-[#dce1fb] hover:bg-[#2e3447]"
                            : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
