"use client"

import { useState } from "react"
import { Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { SectionLabel, NumberInput, UnitBadge, Tooltip } from "@/features/settings/components/members/components/primitives"

function FakePayslip({ isDark }: { isDark: boolean }) {
  const line = (w: string, h = "h-2") => (
    <div className={cn("rounded-full", h, isDark ? "bg-white/10" : "bg-slate-200")} style={{ width: w }} />
  )
  return (
    <div className={cn("rounded-xl border overflow-hidden text-[10px] shadow-sm", isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-200 bg-white")}>
      <div className={cn("px-4 py-3 flex items-center justify-between", isDark ? "bg-white/5" : "bg-slate-50")}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <span className="text-white font-bold" style={{ fontSize: 8 }}>H</span>
          </div>
          {line("60px")}
        </div>
        <div className={cn("px-2 py-0.5 rounded text-[9px] font-bold", isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-600")}>PAID</div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex justify-between items-start">
          <div className="space-y-1.5">{line("80px")}{line("50px", "h-1.5")}</div>
          <div className="text-right space-y-1.5">{line("55px")}{line("35px", "h-1.5")}</div>
        </div>
        <div className={cn("border-t", isDark ? "border-white/5" : "border-slate-100")} />
        {[["Regular hours", "40 hrs", "$2,400.00"], ["Bonus", "—", "$300.00"], ["Tax deduction", "—", "−$540.00"]].map(([label, unit, amt]) => (
          <div key={label} className="flex items-center justify-between">
            <span className={isDark ? "text-white/30" : "text-slate-400"}>{label}</span>
            <span className={isDark ? "text-white/20" : "text-slate-300"}>{unit}</span>
            <span className={cn("font-medium", amt.startsWith("−") ? (isDark ? "text-red-400/60" : "text-red-400") : (isDark ? "text-white/40" : "text-slate-500"))}>{amt}</span>
          </div>
        ))}
        <div className={cn("border-t pt-2 flex justify-between font-bold", isDark ? "border-white/5 text-white/50" : "border-slate-100 text-slate-600")}>
          <span>Net Pay</span><span>$2,160.00</span>
        </div>
      </div>
    </div>
  )
}

export default function Payments({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const [processMode, setProcessMode] = useState<"Manually" | "Automatically">("Manually")
  const [delayDays, setDelayDays] = useState("0")
  const [proofOn, setProofOn] = useState(true)

  return (
    <div className="flex justify-between gap-6">
      {/* left: settings */}
      <div className="space-y-8 max-w-xl">
        <div>
          <h3 className={cn("text-base font-bold mb-1 flex items-center gap-1.5", isDark ? "text-white" : "text-slate-800")}>
            Process Payments
            <Tooltip text="Choose how payments are sent to members">
              <Info className="w-4 h-4 text-blue-400 cursor-help" />
            </Tooltip>
          </h3>
          <p className={cn("text-sm mb-3", isDark ? "text-white/40" : "text-slate-500")}>Choose whether you want to manually send payments or have them automatically processed.</p>
          <div className={cn("inline-flex rounded-full border p-0.5", isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50")}>
            {(["Manually", "Automatically"] as const).map(opt => (
              <button key={opt} onClick={() => setProcessMode(opt)}
                className={cn("px-5 py-1.5 text-sm font-medium rounded-full transition-colors",
                  processMode === opt
                    ? isDark ? "bg-white/10 text-white" : "bg-white text-slate-800 shadow-sm"
                    : isDark ? "text-white/40 hover:text-white/60" : "text-slate-500 hover:text-slate-700"
                )} type="button">
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className={cn("text-base font-bold mb-1 flex items-center gap-1.5", isDark ? "text-white" : "text-slate-800")}>
            Delay payroll
            <Tooltip text="Set a delay before payments are processed">
              <Info className="w-4 h-4 text-blue-400 cursor-help" />
            </Tooltip>
          </h3>
          <p className={cn("text-sm mb-3", isDark ? "text-white/40" : "text-slate-500")}>Set a payroll delay so that all payments can be made at one time</p>
          <SectionLabel label="Send Payments After" info="Number of days to delay after the pay period ends" isDark={isDark} />
          <div className="flex items-center gap-2">
            <NumberInput value={delayDays} onChange={setDelayDays} isDark={isDark} />
            <UnitBadge label="days" isDark={isDark} />
          </div>
        </div>

        <div>
          <h3 className={cn("text-base font-bold mb-1 flex items-center gap-2", isDark ? "text-white" : "text-slate-800")}>
            Proof of Payment PDF
            <span className={cn("px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-full", isDark ? "bg-white/10 text-white/60" : "bg-slate-200 text-slate-600")}>New</span>
            <Tooltip text="Members receive a PDF with payment details">
              <Info className="w-4 h-4 text-blue-400 cursor-help" />
            </Tooltip>
          </h3>
          <p className={cn("text-sm mb-3", isDark ? "text-white/40" : "text-slate-500")}>
            Choose whether you want members paid through payroll integrations (Wise, PayPal or Payoneer) to receive emails with PDF attachments (amounts listed in organization currency).
          </p>
          <div className={cn("inline-flex rounded-full border p-0.5", isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50")}>
            {(["Off", "On"] as const).map(opt => (
              <button key={opt} onClick={() => setProofOn(opt === "On")}
                className={cn("px-6 py-1.5 text-sm font-medium rounded-full transition-colors",
                  (proofOn ? opt === "On" : opt === "Off")
                    ? isDark ? "bg-white/10 text-white" : "bg-white text-slate-800 shadow-sm"
                    : isDark ? "text-white/40 hover:text-white/60" : "text-slate-500 hover:text-slate-700"
                )} type="button">
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* right: save/cancel + disclaimer + payslip */}
      <div className="w-72 shrink-0 flex flex-col gap-4">
        <div className="flex items-center gap-2 justify-end">
          <button className={cn("px-4 py-1.5 text-sm font-medium transition-colors", isDark ? "text-white/50 hover:text-white/80" : "text-slate-500 hover:text-slate-700")} type="button">Cancel</button>
          <button className="px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors" type="button">Save</button>
        </div>

        {proofOn && (
          <div className={cn("p-4 rounded-xl border text-sm space-y-1", isDark ? "bg-blue-500/10 border-blue-500/20 text-blue-300" : "bg-blue-50 border-blue-100 text-blue-800")}>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p>Member and organization details will be included in the PDF attachment</p>
            </div>
            <div className="pl-6 space-y-0.5">
              <p>• Update fields in the <button onClick={() => onNavigate("people-members")} className="text-blue-500 hover:underline" type="button">Member profiles</button></p>
              <p>• Update fields in the <button onClick={() => onNavigate("settings-organization")} className="text-blue-500 hover:underline" type="button">Organization setting</button></p>
            </div>
          </div>
        )}

        {proofOn && (
          <FakePayslip isDark={isDark} />
        )}
      </div>
    </div>
  )
}

