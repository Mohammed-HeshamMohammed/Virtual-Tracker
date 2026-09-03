"use client"

import { useState as useComponentState, type ReactNode } from "react"
import { motion } from "framer-motion"
import { X, Info, AlertTriangle, Calendar } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FilterDropdown, MemberDropdown } from "@/features/financials/components/shared/dropdowns"
import { SingleDatePicker } from "@/features/financials/components/shared/date-pickers"
import { fmtShort } from "@/features/financials/components/shared/date-pickers"

const FREQUENCY_OPTIONS = [
  "One time (On member's next approved timesheet)",
  "Every pay period (Automatic payments only)",
  "First payroll of the month (Automatic payments only)",
]

const ADJUSTMENT_TYPES = ["Addition (+$)", "Deduction (-$)"]

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
      {children}
      {required && <span className="text-red-500"> *</span>}
    </p>
  )
}

export function CreatePayrollAdjustmentModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useComponentState("")
  const [frequency, setFrequency] = useComponentState<string>(FREQUENCY_OPTIONS[0])
  const [member, setMember] = useComponentState<string | null>(null)
  const [adjType, setAdjType] = useComponentState<string>(ADJUSTMENT_TYPES[0])
  const [amount, setAmount] = useComponentState("")
  const [endsOn, setEndsOn] = useComponentState(false)
  
  const [endDate, setEndDate] = useComponentState<Date | null>(new Date(2026, 6, 31))
  const [showEndDate, setShowEndDate] = useComponentState(false)

  const amountNum = Number.parseFloat(amount.replace(/[^0-9.-]/g, ""))
  const valid =
    name.trim().length > 0 &&
    amount.trim().length > 0 &&
    !Number.isNaN(amountNum) &&
    (!endsOn || endDate !== null)

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
        style={{ maxHeight: "min(92vh, 820px)" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">Create payroll adjustment</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5",
            "scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          )}
        >
          <div>
            <FieldLabel required>Name</FieldLabel>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Adjustment name"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 transition-colors" aria-label="Interactive control"
            />
          </div>

          <div>
            <FieldLabel>Frequency</FieldLabel>
            <FilterDropdown
              value={frequency}
              options={FREQUENCY_OPTIONS}
              onChange={setFrequency}
            />
          </div>

          <div>
            <FieldLabel>Members</FieldLabel>
            <MemberDropdown
              label="All members"
              selected={member}
              onSelect={setMember}
            />
            <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                Only members with time worked, PTO, or holidays will receive adjustments.{" "}
                <a href="#" className="font-medium text-blue-500 hover:text-blue-600">
                  Contact support.
                </a>
              </span>
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Adjustment type</FieldLabel>
              <FilterDropdown
                value={adjType}
                options={ADJUSTMENT_TYPES}
                onChange={setAdjType}
              />
            </div>
            <div>
              <FieldLabel required>Amount per member</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-label="Interactive control">USD</span>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full rounded-xl border border-slate-200 py-3 pl-14 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 transition-colors"
                />
              </div>
            </div>
          </div>

          <div>
            <FieldLabel>Ends on</FieldLabel>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={endsOn}
                onClick={() => setEndsOn(v => !v)}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                  endsOn ? "bg-blue-500" : "bg-slate-200"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                    endsOn ? "left-5" : "left-0.5"
                  )}
                />
              </button>
              <span className="text-sm text-slate-600">{endsOn ? "End after date" : "No end date"}</span>
            </div>
            {endsOn ? (
              <div className="relative mt-3">
                <div
                  onClick={() => setShowEndDate((v) => !v)}
                  className={cn(
                    "flex items-center justify-between px-4 py-3 border rounded-xl cursor-pointer transition-colors bg-white",
                    showEndDate ? "border-blue-400 ring-2 ring-blue-400/30" : "border-slate-200 hover:border-slate-300"
                  )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                >
                  <span className="text-sm text-slate-700">{endDate ? fmtShort(endDate) : "Select date"}</span>
                  <Calendar className="w-5 h-5 text-blue-500 shrink-0 ml-2" />
                </div>
                {showEndDate && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowEndDate(false)} />
                    <SingleDatePicker value={endDate} onChange={setEndDate} onClose={() => setShowEndDate(false)} theme="white" />
                  </>
                )}
              </div>
            ) : (
              <input
                type="text"
                readOnly
                disabled
                value="Forever"
                className="mt-3 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400"
              />
            )}
            {endsOn && (
              <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>
                  The end date relates to the end of timesheet / pay period. Depending on your organization payroll settings,
                  the actual payment might happen a few days later and still include this adjustment.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-blue-500 bg-white px-6 py-2.5 text-sm font-semibold text-blue-500 hover:bg-blue-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={onClose}
            className="rounded-xl bg-blue-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
