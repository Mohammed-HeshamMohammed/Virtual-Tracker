"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PAY_PERIODS } from "@/features/members/config/members-config"
import { SimpleSelect } from "@/shared/ui/simple-select";
import type { Member } from "@/features/members/models/member"
import { isOwnerRoleName } from "@/features/auth"

export type BatchEditAction =
  | "payRate"
  | "billRate"
  | "payPeriod"
  | "weeklyLimit"
  | "dailyLimit"
  | "removeFromTree"
  | "remove"

const ACTION_META: Record<
  BatchEditAction,
  { title: string; description: string; submitLabel: string; danger?: boolean }
> = {
  payRate: {
    title: "Edit pay rate",
    description: "Apply a new hourly pay rate to all selected members.",
    submitLabel: "Apply pay rate",
  },
  billRate: {
    title: "Edit bill rate",
    description: "Apply a new hourly bill rate to all selected members.",
    submitLabel: "Apply bill rate",
  },
  payPeriod: {
    title: "Edit pay period",
    description: "Set the pay period for all selected members.",
    submitLabel: "Apply pay period",
  },
  weeklyLimit: {
    title: "Manage weekly limit",
    description: "Set the weekly hour limit for all selected members.",
    submitLabel: "Apply weekly limit",
  },
  dailyLimit: {
    title: "Manage daily limit",
    description: "Set the daily hour limit for all selected members.",
    submitLabel: "Apply daily limit",
  },
  removeFromTree: {
    title: "Remove from tree",
    description:
      "Demote selected members to Viewer, remove them from the hierarchy, and disconnect them from all teams, projects, and assignments.",
    submitLabel: "Remove from tree",
    danger: true,
  },
  remove: {
    title: "Remove members",
    description: "Permanently remove the selected members and their profile data. This cannot be undone.",
    submitLabel: "Remove members",
    danger: true,
  },
}

export function BatchEditModal({
  open,
  action,
  members,
  selectedIds,
  isDark = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  action: BatchEditAction | null
  members: Member[]
  selectedIds: string[]
  isDark?: boolean
  onClose: () => void
  onConfirm: (payload: {
    action: BatchEditAction
    value?: string
    payBill?: { payRate?: string; payPeriod?: string }
    workLimits?: { weeklyLimit?: string; dailyLimit?: string }
  }) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMembers = useMemo(
    () => members.filter((m) => selectedIds.includes(m.id)),
    [members, selectedIds],
  )
  const removableMembers = useMemo(
    () => selectedMembers.filter((m) => !isOwnerRoleName(m.role === "User" ? "Viewer" : m.role)),
    [selectedMembers],
  )
  const ownerBlocked = selectedMembers.some((m) =>
    isOwnerRoleName(m.role === "User" ? "Viewer" : m.role),
  )

  useEffect(() => {
    if (!open) return
    setValue("")
    setError(null)
    setBusy(false)
  }, [open, action])

  if (!open || !action) return null

  const meta = ACTION_META[action]
  const effectiveIds =
    action === "removeFromTree" || action === "remove" ? removableMembers.map((m) => m.id) : selectedIds

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (effectiveIds.length === 0) {
      setError("No eligible members selected for this action.")
      return
    }
    if (action !== "removeFromTree" && action !== "remove" && action !== "payPeriod" && !value.trim()) {
      setError("Enter a value to apply.")
      return
    }
    setBusy(true)
    try {
      if (action === "removeFromTree" || action === "remove") {
        await onConfirm({ action })
        onClose()
        return
      }
      if (action === "payRate" || action === "billRate") {
        await onConfirm({ action, payBill: { payRate: value.trim() } })
      } else if (action === "payPeriod") {
        await onConfirm({ action, payBill: { payPeriod: value || "None" } })
      } else if (action === "weeklyLimit") {
        await onConfirm({ action, workLimits: { weeklyLimit: value.trim() } })
      } else if (action === "dailyLimit") {
        await onConfirm({ action, workLimits: { dailyLimit: value.trim() } })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-600 flex items-center justify-center bg-black/40 p-4"
      aria-label={meta.title}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className={cn(
          "w-full max-w-md rounded-xl border p-6 shadow-xl",
          isDark ? "border-[#3d4a3d]/40 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-900",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{meta.title}</h2>
            <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{meta.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn("rounded-lg p-1", isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-100")}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className={cn("mb-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
          {effectiveIds.length} member{effectiveIds.length === 1 ? "" : "s"} selected
        </p>

        {ownerBlocked && (action === "removeFromTree" || action === "remove") && (
          <div
            className={cn(
              "mb-4 flex gap-2 rounded-lg border px-3 py-2 text-sm",
              isDark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>The Owner account cannot be removed and will be skipped.</span>
          </div>
        )}

        {(action === "removeFromTree" || action === "remove") ? (
          <p className={cn("mb-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
            You are about to remove{" "}
            <strong>{removableMembers.length}</strong> member{removableMembers.length === 1 ? "" : "s"}.
          </p>
        ) : action === "payPeriod" ? (
          <div className="mb-4">
            <label className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              Pay period
            </label>
            <SimpleSelect
              value={value || "None"}
              onChange={setValue}
              options={PAY_PERIODS}
              portalToBody
            />
          </div>
        ) : (
          <div className="mb-4">
            <label
              htmlFor="batch-edit-value"
              className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-[#bccbb9]" : "text-slate-500")}
            >
              {action === "payRate" || action === "billRate"
                ? "Hourly rate (USD)"
                : action === "weeklyLimit"
                  ? "Weekly limit (hours)"
                  : "Daily limit (hours)"}
            </label>
            <input
              id="batch-edit-value"
              type="number"
              min={0}
              step={action === "payRate" || action === "billRate" ? 0.01 : 0.25}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2",
                isDark
                  ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb] focus:ring-[#4be277]/40"
                  : "border-slate-200 bg-white text-slate-900 focus:ring-blue-500/30",
              )}
              disabled={busy}
            />
          </div>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-500" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              ((action === "removeFromTree" || action === "remove") && removableMembers.length === 0)
            }
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
              meta.danger ? "bg-red-600 hover:bg-red-700" : isDark ? "bg-[#4be277] text-[#0c1324] hover:bg-[#3dd068]" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {busy ? "Working…" : meta.submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
