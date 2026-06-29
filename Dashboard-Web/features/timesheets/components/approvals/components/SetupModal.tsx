"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Member, PayPeriod, SetupData } from "@/features/timesheets/components/approvals/types"
import { PAY_PERIOD_OPTIONS } from "@/features/timesheets/components/approvals/data"
import { MemberMultiSelect } from "@/features/timesheets/components/approvals/components/MemberMultiSelect"
import { validateNonEmptySelection } from "@/shared/validation"
import { SelectField } from "@/features/timesheets/components/approvals/components/SelectField"

interface SetupModalProps {
  open: boolean
  members: Member[]
  onClose: () => void
  onSave: (data: SetupData) => void
}

export function SetupModal({ open, members, onClose, onSave }: SetupModalProps) {
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [payPeriod, setPayPeriod] = useState<PayPeriod>("weekly")
  const [autoSetup, setAutoSetup] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
          className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800">Set up timesheet approvals</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5">
            {saveError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
            ) : null}
            <p className="text-sm text-slate-600 leading-relaxed">
              When timesheet approvals are set up, members are required to submit their timesheets for approval before payroll is processed. This can be modified in the{" "}
              <a href="#" className="text-blue-500 hover:underline">
                Timesheet approval settings
              </a>
              .
            </p>

            {/* Members */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                MEMBERS
                <button className="text-slate-400 hover:text-slate-600">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </label>
              <MemberMultiSelect members={members} selected={selectedMembers} onChange={setSelectedMembers} />
            </div>

            {/* Pay Period */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                PAY PERIOD
              </label>
              <SelectField value={payPeriod} onChange={setPayPeriod} options={PAY_PERIOD_OPTIONS} />
            </div>

            {/* Auto setup checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setAutoSetup((v) => !v)}
                className={cn(
                  "mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                  autoSetup ? "bg-blue-500 border-blue-500" : "border-slate-300"
                )}
              >
                {autoSetup && <Check className="w-3 h-3 text-white" />}
              </button>
              <span className="text-sm text-slate-600">
                Automatically set up new members with timesheet approvals and this pay period
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const validationError = validateNonEmptySelection(selectedMembers, "member")
                if (validationError) {
                  setSaveError(validationError)
                  return
                }
                setSaveError(null)
                onSave({ members: selectedMembers, payPeriod, autoSetup })
                onClose()
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
            >
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
