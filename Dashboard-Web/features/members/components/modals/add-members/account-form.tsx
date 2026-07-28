"use client"

import { SimpleSelect } from "@/shared/ui/simple-select";
import { Toggle } from "@/shared/ui/toggle";
import type { MemberRole, AccountFormFields } from "@/features/members/models/member"

interface AccountFormProps {
  form: AccountFormFields
  role: MemberRole
  roleOptions: MemberRole[]
  sendWelcomeEmail: boolean
  onUpdateField: (field: keyof AccountFormFields, val: string) => void
  onRoleChange: (role: MemberRole) => void
  onToggleWelcomeEmail: () => void
}

const inputCls = "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

export function AccountForm({
  form,
  role,
  roleOptions,
  sendWelcomeEmail,
  onUpdateField,
  onRoleChange,
  onToggleWelcomeEmail,
}: AccountFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="add-member-first-name" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              FIRST NAME*
            </label>
            <input
              id="add-member-first-name"
              name="firstName"
              type="text"
              value={form.firstName}
              onChange={(e) => onUpdateField("firstName", e.target.value)}
              placeholder="Jane"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="add-member-last-name" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              LAST NAME*
            </label>
            <input
              id="add-member-last-name"
              name="lastName"
              type="text"
              value={form.lastName}
              onChange={(e) => onUpdateField("lastName", e.target.value)}
              placeholder="Doe"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label htmlFor="add-member-email" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            WORK EMAIL*
          </label>
          <input
            id="add-member-email"
            name="email"
            type="email"
            value={form.email}
            onChange={(e) => onUpdateField("email", e.target.value)}
            placeholder="jane.doe@company.com"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="add-member-pay-rate" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            PAY RATE (USD/HR)
          </label>
          <input
            id="add-member-pay-rate"
            name="payRate"
            type="number"
            value={form.payRate}
            onChange={(e) => onUpdateField("payRate", e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          ROLE*
        </label>
        <SimpleSelect
          value={role}
          onChange={(v) => onRoleChange(v as MemberRole)}
          options={roleOptions}
          portalToBody
          menuMaxVisibleItems={4}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Toggle checked={sendWelcomeEmail} onChange={onToggleWelcomeEmail} />
        <span className="text-sm text-slate-600 dark:text-slate-400">Send welcome email with sign-in instructions</span>
      </div>
    </div>
  )
}
