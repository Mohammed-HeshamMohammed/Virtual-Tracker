/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { SimpleDropdown } from "@/features/settings/components/policy/components/shared"
import {
  OVERTIME_NOTIFICATIONS_SECTION_TOOLTIP,
  OVERTIME_POLICY_MEMBER_OPTIONS,
  OVERTIME_WEEKLY_THRESHOLD_TOOLTIP,
} from "@/features/settings/components/shared/constants"
import { InfoTip } from "@/features/settings/components/policy/components/info-tip"

export function CreateWeeklyOvertimePolicyModal({ onClose }: { onClose: () => void }) {
  const [policyName, setPolicyName] = useState("")
  const [weeklyHours, setWeeklyHours] = useState("40")
  const [multiplier, setMultiplier] = useState("1.5")
  const [members, setMembers] = useState("")

  const hoursNum = Number.parseFloat(weeklyHours)
  const multNum = Number.parseFloat(multiplier)
  const valid =
    policyName.trim().length > 0 &&
    weeklyHours.trim() !== "" &&
    !Number.isNaN(hoursNum) &&
    hoursNum >= 0 &&
    multiplier.trim() !== "" &&
    !Number.isNaN(multNum) &&
    multNum > 0 &&
    members.trim().length > 0

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
        style={{ maxHeight: "min(92vh, 800px)" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">Create weekly overtime policy</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-6 py-5 space-y-6">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Policy name*</p>
            <input
              value={policyName}
              onChange={e => setPolicyName(e.target.value)}
              placeholder="Policy name"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30" aria-label="Interactive control"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-800">Weekly overtime</h3>
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Weekly overtime threshold</p>
                <InfoTip text={OVERTIME_WEEKLY_THRESHOLD_TOOLTIP} />
              </div>
              <div className="flex overflow-hidden rounded-xl border border-slate-200" aria-label="Interactive control">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.25}
                  value={weeklyHours}
                  onChange={e => setWeeklyHours(e.target.value)}
                  className="min-w-0 flex-1 border-0 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <div className="flex shrink-0 items-center border-l border-slate-200 bg-slate-100 px-4 text-sm font-medium text-slate-700">
                  hours
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Weekly overtime pay rate multiplier
              </p>
              <div className="flex flex-wrap items-center gap-2" aria-label="Interactive control">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={multiplier}
                  onChange={e => setMultiplier(e.target.value)}
                  className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-sm text-slate-600">x member&apos;s pay rate</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
              <InfoTip text={OVERTIME_NOTIFICATIONS_SECTION_TOOLTIP} />
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">1 hour before overtime threshold</p>
              <p className="mt-1 text-xs text-slate-500">
                Members, managers, and owners will receive an email notification
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">When member begins overtime</p>
              <p className="mt-1 text-xs text-slate-500">
                Members, managers, and owners will receive an email notification
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800">Policy members</h3>
            <div>
              <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Members</p>
                  <p className="mt-1 text-xs text-slate-400">Members can only be on 1 overtime policy at a time</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMembers("All members")}
                  className="shrink-0 text-sm font-semibold text-blue-500 hover:text-blue-600"
                >
                  Select all
                </button>
              </div>
              <SimpleDropdown
                value={members}
                options={[...OVERTIME_POLICY_MEMBER_OPTIONS]}
                onChange={setMembers}
                placeholder="Select members"
                searchable
              />
            </div>
          </div>
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

