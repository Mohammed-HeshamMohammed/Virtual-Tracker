"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PAY_PERIODS } from "@/features/members/config/members-config"
import { SimpleSelect } from "@/shared/ui/simple-select";
import type { Member } from "@/features/members/models/member"
import { isOwnerRoleName } from "@/features/auth"
import { WorkLimitsTab } from "@/features/members/components/modals/member-manage/tabs/work-limits-tab"
import { initialFormState, type MemberFormState } from "@/features/members/components/modals/member-manage/types"
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"

const PAY_RATE_CURRENCY_VALUES = PAY_RATE_CURRENCIES.map((c) => c.value)

export type BatchEditAction =
  | "payRate"
  | "billRate"
  | "payPeriod"
  | "workTimeLimits"
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
  workTimeLimits: {
    title: "Work time & limits",
    description: "Apply working days, makeup days, and hour limits to all selected members.",
    submitLabel: "Apply work time & limits",
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
    payBill?: { payRate?: string; currency?: string; payPeriod?: string }
    workLimits?: { weeklyLimit?: string; dailyLimit?: string; workDays?: number[]; makeupDays?: number[] }
  }) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [workLimitsState, setWorkLimitsState] = useState<MemberFormState>(initialFormState)
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
    setCurrency("USD")
    setWorkLimitsState(initialFormState)
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
    if (
      action !== "removeFromTree" &&
      action !== "remove" &&
      action !== "payPeriod" &&
      action !== "workTimeLimits" &&
      !value.trim()
    ) {
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
        await onConfirm({ action, payBill: { payRate: value.trim(), currency } })
      } else if (action === "payPeriod") {
        await onConfirm({ action, payBill: { payPeriod: value || "None" } })
      } else if (action === "workTimeLimits") {
        await onConfirm({
          action,
          workLimits: {
            weeklyLimit: workLimitsState.weeklyLimit,
            dailyLimit: workLimitsState.dailyLimit,
            workDays: workLimitsState.workDays,
            makeupDays: workLimitsState.makeupDays,
          },
        })
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
          "w-full rounded-xl border p-6 shadow-xl max-h-[90vh] overflow-y-auto",
          action === "workTimeLimits" ? "max-w-2xl" : "max-w-md",
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
        ) : action === "workTimeLimits" ? (
          <div className="mb-4">
            <WorkLimitsTab
              member={selectedMembers[0] as Member}
              state={workLimitsState}
              setState={setWorkLimitsState}
            />
          </div>
        ) : (
          <div className="mb-4">
            <label
              htmlFor="batch-edit-value"
              className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-[#bccbb9]" : "text-slate-500")}
            >
              Hourly rate
            </label>
            <div className="flex gap-2">
              <input
                id="batch-edit-value"
                type="number"
                min={0}
                step={0.01}
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
              <div className="w-24 shrink-0">
                <SimpleSelect value={currency} onChange={setCurrency} options={PAY_RATE_CURRENCY_VALUES} disabled={busy} />
              </div>
            </div>
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
