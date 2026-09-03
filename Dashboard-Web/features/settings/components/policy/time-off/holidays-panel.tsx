"use client"

import { useState as useComponentState, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { format } from "date-fns"
import { X, Check, Calendar as CalendarIcon } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import {
  HOLIDAY_TEMPLATE_OPTIONS,
  HOLIDAY_TEMPLATE_DEFAULT_NAMES,
} from "@/features/settings/components/shared/constants"
import { SimpleDropdown } from "@/features/settings/components/policy/components/shared"
import { Calendar } from "@/shared/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover"
import { Switch } from "@/shared/ui/switch"
import { AssignMembersThroughStep } from "@/features/settings/components/policy/components/assign-members-through"

function HolidayStepper({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      <div className="flex items-center">
        <div className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold",
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
            Set up holiday
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
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              step === 2 ? "text-blue-500" : "text-slate-400"
            )}
          >
            Assign members
          </span>
        </div>
      </div>
    </div>
  )
}

function AddHolidayModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useComponentState<1 | 2>(1)
  const [template, setTemplate] = useComponentState("")
  const [holidayName, setHolidayName] = useComponentState("")
  const [paidHours, setPaidHours] = useComponentState("0")
  const [holidayDate, setHolidayDate] = useComponentState<Date | undefined>(undefined)
  const [occursAnnually, setOccursAnnually] = useComponentState(false)
  const [dateOpen, setDateOpen] = useComponentState(false)

  useEffect(() => {
    if (!template) {
      setHolidayName("")
      return
    }
    const preset = HOLIDAY_TEMPLATE_DEFAULT_NAMES[template]
    if (preset !== undefined) {
      setHolidayName(preset)
    } else if (template === "Custom") {
      setHolidayName("")
      setHolidayDate(undefined)
    } else {
      setHolidayName(template)
    }
  }, [template])

  const isCustom = template === "Custom"
  const paidHoursNum = Number.parseFloat(paidHours)
  const step1Valid =
    Boolean(template.trim()) &&
    Boolean(holidayName.trim()) &&
    paidHours.trim() !== "" &&
    !Number.isNaN(paidHoursNum) &&
    paidHoursNum >= 0 &&
    (!isCustom || holidayDate !== undefined)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
      <motion.div
        className={cn(
          "relative z-10 bg-white rounded-2xl shadow-2xl w-full flex flex-col min-h-0",
          step === 2 ? "max-w-2xl" : "max-w-xl"
        )}
        style={{ maxHeight: "90vh" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-center justify-between px-8 pt-7 pb-2 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">Add holiday</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-8 pt-2 pb-2 shrink-0">
          <HolidayStepper step={step} />
        </div>

        {step === 1 ? (
          <>
            <div className="px-8 pb-6 flex-1 overflow-y-auto space-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Holiday*</p>
                <SimpleDropdown
                  value={template}
                  options={[...HOLIDAY_TEMPLATE_OPTIONS]}
                  onChange={setTemplate}
                  placeholder="Select holiday"
                  searchable
                />
              </div>

              {template ? (
                <>
                  <p className="text-sm text-slate-600">Choose how you want to set up holidays</p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Holiday name*</p>
                      <input
                        value={holidayName}
                        onChange={e => setHolidayName(e.target.value)}
                        placeholder={isCustom ? "Enter the holiday name" : "Holiday name"}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Paid hours*</p>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.25}
                        value={paidHours}
                        onChange={e => setPaidHours(e.target.value)}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>

                  {isCustom && (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          Select date<span className="text-blue-500">*</span>
                        </p>
                        <Popover open={dateOpen} onOpenChange={setDateOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "w-full flex items-center justify-between gap-2 border rounded-xl px-4 py-3 text-sm text-left transition-colors bg-white",
                                dateOpen || holidayDate
                                  ? "border-blue-400 ring-1 ring-blue-400"
                                  : "border-slate-200 hover:border-slate-300"
                              )}
                            >
                              <span className={holidayDate ? "text-slate-800" : "text-slate-400"}>
                                {holidayDate ? format(holidayDate, "EEE, MMM d, yyyy") : "Select date"}
                              </span>
                              <CalendarIcon className="w-4 h-4 text-blue-500 shrink-0" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 overflow-hidden border-slate-200 shadow-xl" align="start">
                            <Calendar
                              mode="single"
                              selected={holidayDate}
                              onSelect={d => {
                                setHolidayDate(d ?? undefined)
                                if (d) setDateOpen(false)
                              }}
                              defaultMonth={holidayDate ?? new Date(2026, 3, 8)}
                              className="p-0"
                              classNames={{
                                month_caption:
                                  "flex items-center justify-center bg-blue-500 text-white text-sm font-semibold py-2.5 mb-0 rounded-none",
                                nav: "absolute top-2 left-2 right-2 flex justify-between items-center z-10",
                                button_previous:
                                  "text-white hover:bg-white/15 size-8 rounded-md p-0 border-0 bg-transparent",
                                button_next: "text-white hover:bg-white/15 size-8 rounded-md p-0 border-0 bg-transparent",
                                weekday: "text-blue-600 text-[0.7rem] font-medium uppercase first:bg-slate-100 last:bg-slate-100 py-1",
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-3 pb-1 sm:pb-0">
                        <Switch checked={occursAnnually} onCheckedChange={setOccursAnnually} className="data-[state=checked]:bg-blue-500" />
                        <span className="text-sm text-slate-700">Occurs annually</span>
                      </div>
                    </div>
                  )}

                  {!isCustom && (
                    <div className="flex items-center gap-3">
                      <Switch checked={occursAnnually} onCheckedChange={setOccursAnnually} className="data-[state=checked]:bg-blue-500" />
                      <span className="text-sm text-slate-700">Occurs annually</span>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="flex justify-between px-8 py-5 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="px-8 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl font-semibold"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AssignMembersThroughStep
              introText="Choose how you want to assign members into holidays"
              saveLabel="Save"
              autoAddEntity="holiday"
              methodVariant="rich"
              methodPlaceholder="Select how to add members"
              assignmentContext="holiday"
              onBack={() => setStep(1)}
              onSave={onClose}
              onClose={onClose}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

export function HolidaysPanel() {
  const { isDark } = useTheme()
  const [open, setOpen] = useComponentState(false)

  return (
    <div className="w-full">
      <div className="flex flex-col items-center justify-center py-16 gap-4 max-w-md mx-auto text-center">
        <div className="relative w-32 h-32" aria-hidden>
          <svg viewBox="0 0 120 120" className="w-full h-full">
            <rect x="10" y="85" width="100" height="8" rx="2" className={isDark ? "fill-white/10" : "fill-slate-200"} />
            <path
              d="M60 20 L75 55 L60 48 L45 55 Z"
              className={isDark ? "fill-emerald-600" : "fill-emerald-500"}
            />
            <path
              d="M60 35 L82 70 L60 58 L38 70 Z"
              className={isDark ? "fill-emerald-700" : "fill-emerald-600"}
            />
            <path
              d="M60 50 L88 88 L60 72 L32 88 Z"
              className={isDark ? "fill-emerald-800" : "fill-emerald-700"}
            />
            <polygon points="60,12 64,22 56,22" className="fill-amber-400" />
            <rect x="48" y="88" width="24" height="10" rx="2" className={isDark ? "fill-amber-900/80" : "fill-amber-800"} />
            <circle cx="28" cy="62" r="6" className="fill-red-400" />
            <rect x="78" y="78" width="14" height="12" rx="2" className="fill-sky-400" />
            <rect x="88" y="70" width="12" height="10" rx="2" className="fill-indigo-400" />
          </svg>
        </div>
        <h3 className={cn("text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>No holidays added</h3>
        <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>Add holidays for time off</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Add holiday
        </button>
      </div>
      <AnimatePresence>{open && <AddHolidayModal onClose={() => setOpen(false)} />}</AnimatePresence>
    </div>
  )
}

