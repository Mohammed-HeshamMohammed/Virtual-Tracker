"use client"

import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  MODAL_INPUT,
  MODAL_LABEL,
  PAY_PERIODS,
} from "@/features/members/config/members-config"
import { SimpleDatePicker } from "@/shared/ui/simple-date-picker";
import { SimpleSelect } from "@/shared/ui/simple-select";
import { Toggle } from "@/shared/ui/toggle";
import type { TabProps } from "@/features/members/components/modals/member-manage/types"

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      {description ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function PayBillTab({ member, state, setState }: TabProps) {
  const payRate = state.payRate == null ? "" : String(state.payRate)
  const payPeriod = state.payPeriod || "None"
  const isPay = state.paySegment === "pay"

  return (
    <div className="space-y-5">
      <SectionCard
        title="Payment settings"
        description="Switch between pay rate and bill rate configuration."
      >
        <div className="inline-flex w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 sm:w-auto">
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, paySegment: "pay" }))}
            className={cn(
              "flex-1 rounded-md px-4 py-2 text-xs font-semibold transition-all sm:flex-none",
              isPay ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
            )}
          >
            Pay rate
          </button>
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, paySegment: "bill" }))}
            className={cn(
              "flex-1 rounded-md px-4 py-2 text-xs font-semibold transition-all sm:flex-none",
              !isPay ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
            )}
          >
            Bill rate
          </button>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Compensation" description="Hourly rate and pay period for this member.">
          <div className="space-y-4">
            <div>
              <label className={MODAL_LABEL}>{isPay ? "Pay rate" : "Bill rate"}</label>
              <div className="flex">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={isPay ? payRate : ""}
                  disabled={!isPay}
                  onChange={(e) => setState((s) => ({ ...s, payRate: e.target.value }))}
                  className={cn(MODAL_INPUT, "rounded-r-none border-r-0", !isPay && "bg-slate-50 dark:bg-slate-800/60")}
                  aria-label={isPay ? "Pay rate" : "Bill rate"}
                />
                <span className="flex items-center rounded-r-lg border border-l-0 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                  USD/hr
                </span>
              </div>
            </div>
            <div>
              <span className={MODAL_LABEL}>Pay period</span>
              <SimpleSelect
                value={payPeriod}
                onChange={(v) => setState((s) => ({ ...s, payPeriod: v }))}
                options={PAY_PERIODS}
                portalToBody
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Effective date</label>
              <SimpleDatePicker
                value=""
                onChange={() => {}}
                placeholder="Select effective date"
                disabled
                aria-label="Effective date"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Billing & approvals" description="Timesheet and billing preferences.">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-3">
              <Toggle checked={false} onChange={() => {}} />
              <div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Require timesheet approval</span>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Coming soon — display only.</p>
              </div>
            </div>
            {!isPay ? (
              <div>
                <label className={MODAL_LABEL}>Bill rate</label>
                <div className="flex">
                  <input
                    type="text"
                    placeholder="0"
                    className={cn(MODAL_INPUT, "rounded-r-none border-r-0 bg-slate-50 dark:bg-slate-800/60")}
                    disabled
                    aria-label="Bill rate"
                  />
                  <span className="flex items-center rounded-r-lg border border-l-0 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 px-3 text-xs text-slate-500 dark:text-slate-400">
                    USD/hr
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title={isPay ? "Pay rate history" : "Bill rate history"}
        description="Historical compensation records for audit and payroll."
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-md text-left text-xs">
            <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Pay period</th>
                <th className="px-3 py-2.5">Rate</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Start date</th>
                <th className="px-3 py-2.5">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-sm text-slate-600 dark:text-slate-300">
                <td className="px-3 py-2.5">
                  <span className="inline-flex rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    Current
                  </span>
                </td>
                <td className="px-3 py-2.5">{payPeriod}</td>
                <td className="px-3 py-2.5 font-medium">
                  {member.payment === "No rate set" ? "$0.00" : member.payment.replace("/hr", "")}
                </td>
                <td className="px-3 py-2.5">Hourly</td>
                <td className="px-3 py-2.5">{member.dateAdded}</td>
                <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <Info className="h-3 w-3" aria-hidden />
          Rate history reflects stored compensation data.
        </p>
      </SectionCard>
    </div>
  )
}
