"use client"

import { X } from "lucide-react"
import { MAX_INVITES_PER_SUBMIT } from "@/features/members/config/members-config"
import { SimpleSelect } from "@/shared/ui/simple-select";
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"
import type { MemberRole, InviteFormRow } from "@/features/members/models/member"

const PAY_RATE_CURRENCY_VALUES = PAY_RATE_CURRENCIES.map((c) => c.value)

interface InviteFormProps {
  inviteRows: InviteFormRow[]
  role: MemberRole
  roleOptions: MemberRole[]
  onAddRow: () => void
  onRemoveRow: (index: number) => void
  onUpdateRow: (i: number, field: "email" | "payRate" | "currency", val: string) => void
  onRoleChange: (role: MemberRole) => void
}

const inputCls = "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

export function InviteForm({
  inviteRows,
  role,
  roleOptions,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onRoleChange,
}: InviteFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {inviteRows.map((row, i) => (
          <div key={`invite-row-${i}`} className="flex gap-2.5">
            <div className="flex-1 min-w-0">
              {i === 0 && (
                <label htmlFor={`invite-email-${i}`} className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
                  EMAIL*
                </label>
              )}
              <input
                id={`invite-email-${i}`}
                name={`invite-email-${i}`}
                type="email"
                value={row.email}
                onChange={(e) => onUpdateRow(i, "email", e.target.value)}
                placeholder="Add an email"
                aria-label={i === 0 ? undefined : "Email"}
                className={inputCls}
              />
            </div>
            <div className="w-[180px] shrink-0">
              {i === 0 && (
                <label htmlFor={`invite-pay-rate-${i}`} className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
                  PAY RATE
                </label>
              )}
              <div className="flex" aria-label="Interactive control">
                <input
                  id={`invite-pay-rate-${i}`}
                  name={`invite-pay-rate-${i}`}
                  type="number"
                  value={row.payRate}
                  onChange={(e) => onUpdateRow(i, "payRate", e.target.value)}
                  placeholder="Rate"
                  aria-label={i === 0 ? undefined : "Pay rate"}
                  className="peer flex-1 min-w-0 px-2.5 py-2 border border-r-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-l-lg text-xs placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 transition-colors"
                />
                <div className="w-20 shrink-0">
                  <SimpleSelect
                    value={row.currency || "USD"}
                    onChange={(v) => onUpdateRow(i, "currency", v)}
                    options={PAY_RATE_CURRENCY_VALUES}
                    className="rounded-l-none"
                  />
                </div>
              </div>
            </div>
            <div className="w-8 shrink-0">
              {i === 0 && <div className="h-[22px]" />}
              {inviteRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveRow(i)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
                  aria-label="Remove invite row"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAddRow}
        disabled={inviteRows.length >= MAX_INVITES_PER_SUBMIT}
        className="text-xs text-blue-500 dark:text-emerald-400 hover:text-blue-600 dark:hover:text-emerald-300 font-semibold transition-colors disabled:text-slate-400 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
      >
        + Invite another
      </button>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">ROLE*</label>
          <span className="text-sm text-blue-500 dark:text-emerald-400 hover:underline cursor-pointer">Learn more</span>
        </div>
        <SimpleSelect
          value={role}
          onChange={(v) => onRoleChange(v as MemberRole)}
          options={roleOptions}
          portalToBody
          menuMaxVisibleItems={4}
        />
      </div>
    </div>
  )
}
