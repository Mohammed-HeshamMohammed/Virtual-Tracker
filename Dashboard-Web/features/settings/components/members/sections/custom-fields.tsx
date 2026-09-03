"use client"

import { useEffect, useState } from "react"
import { X, Plus } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useCustomFields } from "@/features/settings/hooks/use-custom-fields"
import { SectionLabel, Toggle, SubNavLayout } from "@/features/settings/components/members/components/primitives"
import { CUSTOM_FIELDS_SUBNAV, type CustomFieldsTabKey } from "@/features/settings/components/shared/constants"

function AddCustomFieldModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>
      <div onClick={e => e.stopPropagation()} className={cn("w-full max-w-md rounded-2xl shadow-2xl p-7 space-y-5", isDark ? "bg-[#151b2d] border border-white/10" : "bg-white")}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className={cn("text-lg font-bold", isDark ? "text-white" : "text-slate-800")}>Add custom field</h2>
            <p className={cn("text-sm mt-1", isDark ? "text-white/40" : "text-slate-500")}>This field will be added to all member profiles and can be viewed in reports.</p>
          </div>
          <button onClick={onClose} type="button"><X className={cn("w-5 h-5 mt-1", isDark ? "text-white/40" : "text-slate-400")} aria-label="Interactive control" /></button>
        </div>
        <div>
          <SectionLabel label="Field Title *" isDark={isDark} />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Field title"
            className={cn("w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors",
              isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300"
            )} />
        </div>
        <div className={cn("flex items-start gap-3 p-4 rounded-xl", isDark ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-100")}>
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">+</span>
          </div>
          <div>
            <span className={cn("text-sm font-bold", isDark ? "text-white" : "text-slate-800")}>Custom profile fields</span>
            <p className={cn("text-xs mt-0.5", isDark ? "text-white/40" : "text-slate-500")}>
              Fields you add appear on member profiles and can be used in reporting.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className={cn("px-5 py-2 text-sm font-medium border rounded-lg transition-colors", isDark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50")} type="button">Cancel</button>
          <button className="px-5 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors" type="button">Save</button>
        </div>
      </div>
    </div>
  )
}

function ProfileFields({ isDark }: { isDark: boolean }) {
  const [modal, setModal] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <SectionLabel label="Member Profiles" isDark={isDark} />
          <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Add or edit custom fields that appear on member profiles</p>
        </div>
        <button onClick={() => setModal(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shrink-0" type="button">
          <Plus className="w-4 h-4" /> Add custom field
        </button>
      </div>
      <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
        <div className={cn("grid px-4 py-3 text-sm font-semibold", isDark ? "text-white/70" : "text-slate-700")}
          style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <span>Field</span><span>Created by</span><span>Created on</span>
        </div>
        <div className={cn("border-t", isDark ? "border-white/5" : "border-slate-100")}>
          <div className="flex flex-col items-center py-14 gap-3">
            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center", isDark ? "bg-white/5" : "bg-slate-100")}>
              <div className={cn("w-8 h-5 rounded border-2", isDark ? "border-white/20" : "border-slate-300")} />
            </div>
            <p className={cn("text-base font-bold", isDark ? "text-white/60" : "text-slate-700")}>Add custom profile fields</p>
            <p className={cn("text-sm text-center", isDark ? "text-white/30" : "text-slate-400")}>Create new fields to add to member profiles</p>
          </div>
        </div>
      </div>
      {modal && <AddCustomFieldModal isDark={isDark} onClose={() => setModal(false)} />}
    </div>
  )
}

function EmailNotifications({ isDark }: { isDark: boolean }) {
  const [allowed, setAllowed] = useState(false)
  return (
    <div className="space-y-5">
      <div className={cn("flex items-center justify-between p-4 rounded-xl border", isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-100")}>
        <div className="flex items-center gap-2">
          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center", isDark ? "bg-blue-500/20" : "bg-blue-100")}>
            <span className="text-blue-500 text-xs">🔒</span>
          </div>
          <span className={cn("text-sm", isDark ? "text-blue-300" : "text-blue-700")}>This feature can be purchased by upgrading to the Enterprise plan.</span>
        </div>
        <button className="px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shrink-0" type="button">View plans & add-ons</button>
      </div>
      <div>
        <SectionLabel label="Email Notifications" isDark={isDark} />
        <p className={cn("text-sm mb-1", isDark ? "text-white/40" : "text-slate-500")}>
          When creating new accounts, this sets whether the members will receive email communication from the organization. This includes notifications about their own work as well as anyone they might manage.
        </p>
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>
          This setting can be altered when creating the accounts or individually overridden afterwards in the table below.
        </p>
        <SectionLabel label="Default" info="Global default for all new members" isDark={isDark} />
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle checked={allowed} onChange={() => setAllowed(p => !p)} />
          <span className={cn("text-sm", isDark ? "text-white/70" : "text-slate-700")}>Allow members to receive organization emails</span>
        </label>
      </div>
    </div>
  )
}

export default function CustomFields() {
  const { isDark } = useTheme()
  const [sub, setSub] = useState<"profile" | "email">("profile")

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("vt-custom-fields-sub")
      if (raw === "profile" || raw === "email") {
        setSub(raw)
      }
      sessionStorage.removeItem("vt-custom-fields-sub")
    } catch {
      sessionStorage.removeItem("vt-custom-fields-sub")
    }
  }, [])

  return (
    <SubNavLayout
      items={CUSTOM_FIELDS_SUBNAV}
      active={sub}
      onChange={(k) => {
        if (k === "profile" || k === "email") setSub(k)
      }}
      isDark={isDark}
    >
      {sub === "profile" && <ProfileFields isDark={isDark} />}
      {sub === "email" && <EmailNotifications isDark={isDark} />}
    </SubNavLayout>
  )
}

