"use client"

import { useState as useComponentState } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SimpleDropdown } from "@/features/settings/components/policy/components/shared"
import { WORK_BREAK_PAID_TYPES, WORK_BREAK_RESTRICTIONS } from "@/features/settings/components/shared/constants"
import { InfoTip } from "@/features/settings/components/policy/components/info-tip"

const DEMO_MEMBER_OPTIONS: string[] = []

const NOTIFY_TOOLTIP =
  "Send reminders when breaks are due or when a break window is about to end."

export function AddWorkBreakPolicyModal({ onClose }: { onClose: () => void }) {
  const [policyName, setPolicyName] = useComponentState("")
  const [members, setMembers] = useComponentState("")
  const [autoAdd, setAutoAdd] = useComponentState(true)
  const [paidType, setPaidType] = useComponentState("Paid")
  const [duration, setDuration] = useComponentState("0")
  const [restriction, setRestriction] = useComponentState("No restrictions")
  const [notify, setNotify] = useComponentState(true)

  const valid =
    policyName.trim().length > 0 &&
    duration.trim() !== "" &&
    !Number.isNaN(Number.parseFloat(duration)) &&
    Number.parseFloat(duration) >= 0

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <motion.div
        className="relative z-10 flex w-full max-w-lg flex-col overflow-visible rounded-2xl bg-white shadow-2xl"
        style={{ maxHeight: "min(90vh, 720px)" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">Add work break policy</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-6 py-5 space-y-5">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Policy name*</p>
            <input
              value={policyName}
              onChange={e => setPolicyName(e.target.value)}
              placeholder="Enter a name for the policy (ex: Rest or Lunch)"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30" aria-label="Interactive control"
            />
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Members</p>
            <SimpleDropdown
              value={members}
              options={DEMO_MEMBER_OPTIONS}
              onChange={setMembers}
              placeholder="Select members"
              searchable
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoAdd}
              onChange={() => setAutoAdd(v => !v)}
              className="h-4 w-4 rounded border-slate-300 accent-teal-600"
            />
            <span className="text-sm text-slate-700">Automatically add new members to this policy</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Type</p>
              <SimpleDropdown
                value={paidType}
                options={[...WORK_BREAK_PAID_TYPES]}
                onChange={setPaidType}
                placeholder="Paid"
              />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Allotted duration*</p>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.25}
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Restrictions</p>
            <SimpleDropdown
              value={restriction}
              options={[...WORK_BREAK_RESTRICTIONS]}
              onChange={setRestriction}
              placeholder="No restrictions"
            />
            <p className="mt-2 text-xs text-slate-400">This cannot be edited once the policy has been created.</p>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={notify}
              onChange={() => setNotify(v => !v)}
              className="h-4 w-4 rounded border-slate-300 accent-teal-600"
            />
            <span className="text-sm text-slate-700">Notify members about their breaks</span>
            <InfoTip text={NOTIFY_TOOLTIP} />
          </label>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={onClose}
            className="rounded-xl bg-blue-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

