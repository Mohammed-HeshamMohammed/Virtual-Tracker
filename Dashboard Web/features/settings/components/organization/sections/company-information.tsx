"use client"

import { useTheme } from "@/shared/providers/app"
import { Label, Input, Select } from "@/features/settings/components/organization/components/ui"
import { INDUSTRIES, CURRENCIES, WEEK_STARTS, TIME_ZONES } from "@/features/settings/components/shared/constants"

export default function CompanyInformation() {
  const { isDark } = useTheme()

  return (
    <div className="py-4 w-full space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div><Label label="Name" required isDark={isDark} /><Input defaultValue="Acme Corp" isDark={isDark} /></div>
        <div><Label label="Industry" required isDark={isDark} /><Select options={INDUSTRIES} defaultValue="Technology" isDark={isDark} /></div>
        <div><Label label="Currency" required info="The default currency for all financial transactions and reporting." isDark={isDark} /><Select options={CURRENCIES} defaultValue="USD - United States Dollar" isDark={isDark} /></div>
        <div><Label label="Start Week On" required isDark={isDark} /><Select options={WEEK_STARTS} defaultValue="Monday" isDark={isDark} /></div>
        <div><Label label="Tax ID" info="Your organization's tax identification number." isDark={isDark} /><Input placeholder="Enter tax ID" isDark={isDark} /></div>
        <div>
          <Label label="Logo" isDark={isDark} />
          <div className="flex items-center gap-3">
            <label className={`cursor-pointer px-3 py-2 text-sm border rounded-lg transition-colors ${isDark ? "border-white/10 bg-[#1a2235] text-white/70 hover:bg-white/5" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              Choose File<input type="file" className="hidden" />
            </label>
            <span className={`text-sm ${isDark ? "text-white/30" : "text-slate-400"}`}>Max 1 MB</span>
          </div>
        </div>
      </div>
      <div><Label label="Time Zone" required isDark={isDark} /><Select options={TIME_ZONES} defaultValue="(GMT-05:00) America/New_York" isDark={isDark} /></div>
      <div><Label label="Address" isDark={isDark} /><Input isArea isDark={isDark} /></div>
      <div className="flex gap-3 pt-2 pb-6">
        <button className={`px-5 py-2 text-sm font-medium border rounded-lg transition-colors ${isDark ? "border-white/10 text-white/50 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`} type="button">Cancel</button>
        <button className="px-5 py-2 text-sm font-semibold bg-[#006e2f] text-white rounded-lg hover:bg-[#005a26] transition-colors" type="button">Save</button>
      </div>
    </div>
  )
}

