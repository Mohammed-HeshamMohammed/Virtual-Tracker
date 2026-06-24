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

const inputCls = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"

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
      <div className="space-y-2.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              FIRST NAME*
            </label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => onUpdateField("firstName", e.target.value)}
              placeholder="Jane"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              LAST NAME*
            </label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => onUpdateField("lastName", e.target.value)}
              placeholder="Doe"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            WORK EMAIL*
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => onUpdateField("email", e.target.value)}
            placeholder="jane.doe@company.com"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            PAY RATE (USD/HR)
          </label>
          <input
            type="number"
            value={form.payRate}
            onChange={(e) => onUpdateField("payRate", e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
        <span className="text-sm text-slate-600">Send welcome email with sign-in instructions</span>
      </div>
    </div>
  )
}
