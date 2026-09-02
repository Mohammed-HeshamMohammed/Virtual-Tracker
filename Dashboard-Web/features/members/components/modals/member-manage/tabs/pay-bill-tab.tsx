"use client"

import type { ReactNode } from "react"
import { Info, Lock } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { formatDateAdded } from "@/features/members/utils/member-utils"
import { formatPayRateDisplay } from "@/features/members/config/pay-currencies"
import {
  MODAL_INPUT,
  MODAL_LABEL,
  PAY_PERIODS,
} from "@/features/members/config/members-config"
import { SimpleDatePicker } from "@/shared/ui/simple-date-picker";
import { SimpleSelect } from "@/shared/ui/simple-select";
import { Toggle } from "@/shared/ui/toggle";
import type { TabProps } from "@/features/members/components/modals/member-manage/types"
import type { PayRateHistoryEntry } from "@/features/members/api/member-api"
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"

const PAY_RATE_CURRENCY_VALUES = PAY_RATE_CURRENCIES.map((c) => c.value)

interface PayBillTabProps extends TabProps {
  /** Owner/Super Admin/Admin/Super Manager only - server enforces this
   * (member-profile.service.js); this only decides whether the tab reads as
   * editable or read-only for the signed-in actor. */
  canEditPayRate: boolean
}

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

function historyRowLabel(index: number): { text: string; tone: "current" | "past" } {
  return index === 0 ? { text: "Current", tone: "current" } : { text: "Past", tone: "past" }
}

function HistoryStatusPill({ tone, children }: { tone: "current" | "past"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tone === "current"
          ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
          : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
      )}
    >
      {children}
    </span>
  )
}

/** Real rows from pay_rate_history when there are any; a member whose rate
 * has never changed since this table existed has none yet, so this falls
 * back to one synthesized "Current" row built from the live pay_rates
 * values - same as what the tab always showed, just now honestly labeled as
 * a fallback rather than presented as if it were history. */
function buildDisplayRows(
  history: PayRateHistoryEntry[],
  fallback: { payRate: string; payPeriod: string; dateAdded: string },
): { key: string; tone: "current" | "past"; payPeriod: string; rateLabel: string; date: string; note: string; changedBy: string }[] {
  if (history.length > 0) {
    return history.map((entry, index) => ({
      key: entry.id || String(index),
      tone: historyRowLabel(index).tone,
      payPeriod: entry.payPeriod,
      rateLabel: formatPayRateDisplay(entry.rate, entry.currency),
      date: entry.effectiveDate || entry.createdAt,
      note: entry.note,
      changedBy: entry.changedByName,
    }))
  }
  const rate = Number(fallback.payRate)
  if (!Number.isFinite(rate) || rate <= 0) return []
  return [
    {
      key: "current-fallback",
      tone: "current",
      payPeriod: fallback.payPeriod,
      rateLabel: formatPayRateDisplay(rate),
      date: fallback.dateAdded,
      note: "",
      changedBy: "",
    },
  ]
}

export function PayBillTab({ member, state, setState, canEditPayRate }: PayBillTabProps) {
  const payRate = state.payRate == null ? "" : String(state.payRate)
  const payPeriod = state.payPeriod || "None"
  const isPay = state.paySegment === "pay"
  const editable = canEditPayRate
  const rows = buildDisplayRows(state.payRateHistory, {
    payRate,
    payPeriod,
    dateAdded: formatDateAdded(member.dateAdded),
  })

  return (
    <div className="space-y-5">
      {!editable ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Only Super Manager and above can edit pay rates. You can view this member&apos;s compensation, but not change it.</span>
        </div>
      ) : null}

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
                  disabled={!isPay || !editable}
                  onChange={(e) => setState((s) => ({ ...s, payRate: e.target.value }))}
                  className={cn(MODAL_INPUT, "rounded-r-none border-r-0", (!isPay || !editable) && "bg-slate-50 dark:bg-slate-800/60")}
                  aria-label={isPay ? "Pay rate" : "Bill rate"}
                />
                <div className="w-24 shrink-0">
                  <SimpleSelect
                    value={state.currency || "USD"}
                    onChange={(v) => setState((s) => ({ ...s, currency: v }))}
                    options={PAY_RATE_CURRENCY_VALUES}
                    disabled={!isPay || !editable}
                    className="rounded-l-none"
                  />
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Rate is hourly.</p>
            </div>
            <div>
              <span className={MODAL_LABEL}>Pay period</span>
              <SimpleSelect
                value={payPeriod}
                onChange={(v) => setState((s) => ({ ...s, payPeriod: v }))}
                options={PAY_PERIODS}
                portalToBody
                disabled={!editable}
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Effective date</label>
              <SimpleDatePicker
                value={state.payEffectiveDate}
                onChange={(v) => setState((s) => ({ ...s, payEffectiveDate: v }))}
                placeholder="Select effective date"
                disabled={!editable}
                aria-label="Effective date"
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                When this rate takes effect. Left blank, it defaults to today.
              </p>
            </div>
            <div>
              <label className={MODAL_LABEL}>Note</label>
              <textarea
                value={state.payNote}
                disabled={!editable}
                onChange={(e) => setState((s) => ({ ...s, payNote: e.target.value }))}
                placeholder="Reason for this change (raise, promotion, correction, …) — shown in the history below."
                rows={2}
                className={cn(MODAL_INPUT, "min-h-16 resize-y", !editable && "bg-slate-50 dark:bg-slate-800/60")}
                aria-label="Pay rate note"
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
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
            No pay rate history yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-md text-left text-xs">
              <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Pay period</th>
                  <th className="px-3 py-2.5">Rate</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Effective date</th>
                  <th className="px-3 py-2.5">Changed by</th>
                  <th className="px-3 py-2.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-50 dark:border-slate-800/60 text-sm text-slate-600 dark:text-slate-300 last:border-b-0">
                    <td className="px-3 py-2.5">
                      <HistoryStatusPill tone={row.tone}>{row.tone === "current" ? "Current" : "Past"}</HistoryStatusPill>
                    </td>
                    <td className="px-3 py-2.5">{row.payPeriod}</td>
                    <td className="px-3 py-2.5 font-medium">{row.rateLabel}</td>
                    <td className="px-3 py-2.5">Hourly</td>
                    <td className="px-3 py-2.5">{formatDateAdded(row.date)}</td>
                    <td className="px-3 py-2.5">{row.changedBy || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500">{row.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <Info className="h-3 w-3" aria-hidden />
          Rate history reflects stored compensation data.
        </p>
      </SectionCard>
    </div>
  )
}
