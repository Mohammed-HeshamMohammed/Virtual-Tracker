/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { Dispatch, ReactNode, SetStateAction } from "react"
import { X, Info, CheckSquare, Square, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SimpleDropdown } from "@/features/settings/components/policy/components/shared"
import { AssignMembersThroughStep } from "@/features/settings/components/policy/components/assign-members-through"

// ─── Types ────────────────────────────────────────────────────────────────────

type AccrualSchedule = "None" | "Annual" | "Monthly" | "Hours worked" | "Policy joined date"
type PaidStatus = "Paid" | "Unpaid"
type AmountUnit = "hours / month" | "hours / year"
type AccrualDay = "Monthly anniversary" | "First day of the month" | "Last day of the month"

interface PolicyForm {
  name: string
  accrual: AccrualSchedule
  startingBalance: string
  maxAccrualAmount: string
  accrualAmount: string
  accrualUnit: AmountUnit
  accrualDay: AccrualDay
  allowProrated: boolean
  allowNegative: boolean
  rollsOver: boolean
  requireApproval: boolean
  paidStatus: PaidStatus
}

const ACCRUAL_OPTIONS: AccrualSchedule[] = ["None", "Annual", "Monthly", "Hours worked", "Policy joined date"]
const ACCRUAL_DAY_OPTIONS: AccrualDay[] = ["Monthly anniversary", "First day of the month", "Last day of the month"]
const AMOUNT_UNIT_OPTIONS: AmountUnit[] = ["hours / month", "hours / year"]

const ACCRUAL_TOOLTIPS: Record<AccrualSchedule, string> = {
  None: "Time off will not be automatically accrued for this policy",
  Annual: "Hours are accrued when the member joins the policy, and on January 1st of every year",
  Monthly: "Hours are accrued on the monthly accrual day",
  "Hours worked": "Hours are accrued when time worked is marked as paid",
  "Policy joined date": "Hours are accrued when the member is added to the policy, at a prorated amount for the year. Hours are also accrued on January 1st of every year.",
}

const DEFAULT_FORM: PolicyForm = {
  name: "",
  accrual: "Annual",
  startingBalance: "",
  maxAccrualAmount: "",
  accrualAmount: "",
  accrualUnit: "hours / month",
  accrualDay: "Monthly anniversary",
  allowProrated: true,
  allowNegative: true,
  rollsOver: true,
  requireApproval: false,
  paidStatus: "Paid",
}

// ─── Sub-components ───────────────────────────────────────────────────────────

import { Tooltip } from "@/shared/ui/simple-tooltip"

function CheckOption({ checked, onToggle, label, description }: { checked: boolean; onToggle: () => void; label: string; description: string }) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        "flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all",
        checked ? "border-blue-400 bg-blue-50/50" : "border-slate-200 hover:border-slate-300"
      )}
    >
      {checked
        ? <CheckSquare className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        : <Square className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
      }
      <div>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{children}</p>
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      <div className="flex items-center">
        <div className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-colors",
              step > 1
                ? "border-emerald-500 bg-emerald-500 text-white"
                : step === 1
                  ? "border-blue-400 text-blue-500 bg-white"
                  : "border-slate-200 text-slate-400 bg-white"
            )}
          >
            {step > 1 ? <Check className="w-4 h-4 stroke-[3]" /> : "1"}
          </div>
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              step === 1 ? "text-blue-500" : "text-slate-400"
            )}
          >
            Set up policy
          </span>
        </div>
        <div className={cn("w-48 h-px mb-5 mx-1 shrink-0", step > 1 ? "bg-emerald-500" : "bg-slate-200")} />
        <div className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold",
              step === 2 ? "border-blue-400 text-blue-500 bg-white" : "border-slate-200 text-slate-400 bg-white"
            )}
          >
            2
          </div>
          <span className={cn("text-[10px] font-bold uppercase tracking-wider", step === 2 ? "text-blue-500" : "text-slate-400")}>
            Assign members
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function StepSetupPolicy({ form, setForm, onNext, onClose }: {
  form: PolicyForm
  setForm: Dispatch<SetStateAction<PolicyForm>>
  onNext: () => void
  onClose: () => void
}) {
  const set = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) => setForm(p => ({ ...p, [k]: v }))

  const showStartingBalance = form.accrual === "None"
  const showMonthlyFields = form.accrual === "Monthly"
  const showHoursWorkedFields = form.accrual === "Hours worked"
  const showMaxAccrual = form.accrual !== "None"
  const showOptions = form.accrual !== "None"
  const showProrated = form.accrual === "Monthly"

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 space-y-6" style={{ scrollbarWidth: "none" }}>

        <div>
          <SectionLabel>Policy name*</SectionLabel>
          <input
            value={form.name}
            onChange={e => set("name", e.target.value)}
            placeholder="Enter the policy name"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          />
        </div>

        <div>
          <p className="text-base font-bold text-slate-800 mb-4">Accrual</p>

          <SectionLabel>Schedule of accrual</SectionLabel>
          <div className="flex flex-wrap gap-2 mb-5">
            {ACCRUAL_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => set("accrual", opt)}
                className={cn(
                  "relative px-4 py-2 rounded-full border text-sm transition-all",
                  form.accrual === opt ? "border-blue-400 text-blue-500 bg-white font-semibold" : "border-slate-200 text-slate-500 hover:border-slate-300"
                )} type="button"
              >
                {opt}
                {form.accrual === opt && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-400 border border-white" />
                )}
                <Tooltip text={ACCRUAL_TOOLTIPS[opt]}>
                  <Info className="ml-1 inline h-3 w-3 text-slate-400" />
                </Tooltip>
              </button>
            ))}
          </div>

          {showStartingBalance && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SectionLabel>Starting balance</SectionLabel>
              <input
                value={form.startingBalance}
                onChange={e => set("startingBalance", e.target.value)}
                placeholder="Enter amount of hours"
                type="number"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </motion.div>
          )}

          {showMonthlyFields && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4" aria-label="Interactive control">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <SectionLabel>
                    Accrual amount*
                    <Tooltip text="Total hours accrued per period">
                      <Info className="ml-1 inline h-3.5 w-3.5 cursor-help text-slate-400" />
                    </Tooltip>
                  </SectionLabel>
                  <div className="flex">
                    <input
                      value={form.accrualAmount}
                      onChange={e => set("accrualAmount", e.target.value)}
                      type="number"
                      className="w-24 border border-r-0 border-slate-200 rounded-l-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <div className="border border-slate-200 rounded-r-xl">
                      <SimpleDropdown
                        value={form.accrualUnit}
                        options={AMOUNT_UNIT_OPTIONS}
                        onChange={(v: string) => set("accrualUnit", v as AmountUnit)} aria-label="Interactive control"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <SectionLabel>
                    Accrual day
                    <Tooltip text="Select which day of the month the days will become available">
                      <Info className="ml-1 inline h-3.5 w-3.5 cursor-help text-slate-400" />
                    </Tooltip>
                  </SectionLabel>
                  <SimpleDropdown
                    value={form.accrualDay}
                    options={ACCRUAL_DAY_OPTIONS}
                    onChange={(v: string) => set("accrualDay", v as AccrualDay)}
                  />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="2"/><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="2"/><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="2"/><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="2"/></svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-blue-600 mb-0.5">Accrual calculator</p>
                  <div className="flex gap-8 text-xs text-blue-500">
                    <div><span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Per month</span><p className="font-semibold">{form.accrualAmount ? `${form.accrualAmount} hrs` : "--"}</p></div>
                    <div><span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Per year</span><p className="font-semibold">{form.accrualAmount ? `${(parseFloat(form.accrualAmount) * 12).toFixed(1)} hrs` : "--"}</p></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {showHoursWorkedFields && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-slate-600">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p>Time off hours accrue only when hours are <strong>marked as paid</strong> — they're included in a payment record, not necessarily paid out. <button className="text-blue-500 underline" type="button">Learn more ↗</button></p>
              </div>
              <div>
                <SectionLabel>Amount accrued*</SectionLabel>
                <div className="flex items-center gap-2">
                  <input
                    value={form.accrualAmount}
                    onChange={e => set("accrualAmount", e.target.value)}
                    type="number"
                    className="w-24 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="px-3 py-3 border border-slate-200 rounded-xl text-sm text-slate-500 bg-slate-50">hour(s) accrued for every</span>
                  <input
                    value={form.maxAccrualAmount}
                    onChange={e => set("maxAccrualAmount", e.target.value)}
                    type="number"
                    className="w-24 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="px-3 py-3 border border-slate-200 rounded-xl text-sm text-slate-500 bg-slate-50">hours worked</span>
                </div>
              </div>
            </motion.div>
          )}

          {form.accrual === "Policy joined date" && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-slate-600">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p>Balances are prorated and may take up to <strong>24 hours</strong> to display for members added to a time off policy set to "Policy joined date".</p>
              </div>
            </motion.div>
          )}

          {showMaxAccrual && (
            <div className={showMonthlyFields || showHoursWorkedFields || form.accrual === "Policy joined date" ? "mt-4" : ""}>
              <SectionLabel>Maximum accrual amount*</SectionLabel>
              <div className="flex">
                <input
                  value={form.maxAccrualAmount}
                  onChange={e => set("maxAccrualAmount", e.target.value)}
                  type="number"
                  className="w-40 border border-r-0 border-slate-200 rounded-l-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="px-4 py-3 border border-slate-200 rounded-r-xl text-sm text-slate-500 bg-slate-50">hours per year</span>
              </div>
            </div>
          )}
        </div>

        {showProrated && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allowProrated}
              onChange={() => set("allowProrated", !form.allowProrated)}
              className="w-4 h-4 accent-blue-500 rounded"
            />
            <span className="text-sm text-slate-700">Allow prorated time based on start date</span>
            <Tooltip text="Time earned mid-month will be prorated based on start date.">
              <Info className="inline h-3.5 w-3.5 cursor-help text-slate-400" />
            </Tooltip>
          </label>
        )}

        {showOptions && (
          <div>
            <p className="text-base font-bold text-slate-800 mb-3">Options</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <CheckOption
                checked={form.allowNegative}
                onToggle={() => set("allowNegative", !form.allowNegative)}
                label="Allow negative balances"
                description="Members may request time off even if it lowers their balance to below 0"
              />
              <CheckOption
                checked={form.rollsOver}
                onToggle={() => set("rollsOver", !form.rollsOver)}
                label="Balance rolls over annually"
                description="Any remaining balance will be kept on January 1st"
              />
            </div>
            <CheckOption
              checked={form.requireApproval}
              onToggle={() => set("requireApproval", !form.requireApproval)}
              label="Require approval"
              description="Requests must be manually approved by a manager or team lead"
            />
          </div>
        )}

        <div>
          <p className="text-base font-bold text-slate-800 mb-3">Paid or unpaid</p>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {(["Paid", "Unpaid"] as PaidStatus[]).map(opt => (
              <button
                key={opt}
                onClick={() => set("paidStatus", opt)}
                className={cn(
                  "px-6 py-2 text-sm font-medium transition-colors",
                  form.paidStatus === opt ? "bg-white text-blue-500 font-bold" : "text-slate-500 hover:text-slate-700"
                )} type="button"
              >
                {opt}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">Hours in approved time off requests will count towards amounts owed</p>
        </div>
      </div>

      <div className="flex justify-between px-8 py-5 border-t border-slate-100 shrink-0">
        <button onClick={onClose} className="px-6 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors" type="button">Cancel</button>
        <button onClick={onNext} className="px-8 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-colors" type="button">Next</button>
      </div>
    </>
  )
}

// ─── Add Policy Modal ─────────────────────────────────────────────────────────

function AddPolicyModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<PolicyForm>(DEFAULT_FORM)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: "90vh" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-center justify-between px-8 pt-7 pb-2 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">Add time off policy</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" type="button" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}><X className="w-5 h-5" /></button>
        </div>

        <div className="px-8 pt-4 pb-2 shrink-0">
          <Stepper step={step} />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div key="step1" className="flex flex-col flex-1 min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <StepSetupPolicy form={form} setForm={setForm} onNext={() => setStep(2)} onClose={onClose} />
            </motion.div>
          ) : (
            <motion.div key="step2" className="flex flex-col flex-1 min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AssignMembersThroughStep
                introText="Choose how you want to assign members to the time off policy"
                saveLabel="Save policy"
                autoAddEntity="policy"
                methodVariant="simple"
                methodPlaceholder="Select method"
                assignmentContext="policy"
                onBack={() => setStep(1)}
                onSave={onClose}
                onClose={onClose}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

export { AddPolicyModal }

