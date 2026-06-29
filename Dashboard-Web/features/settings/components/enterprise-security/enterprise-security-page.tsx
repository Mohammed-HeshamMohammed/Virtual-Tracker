"use client"

import { useState } from "react"
import { Shield, KeyRound, ScrollText, GlobeLock, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  isDark,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  isDark: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between",
        isDark ? "border-white/10 bg-white/2" : "border-slate-200 bg-slate-50/50"
      )}
    >
      <div className="min-w-0">
        <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{label}</p>
        <p className={cn("mt-1 text-xs leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 self-start rounded-full transition-colors sm:self-auto",
          checked ? "bg-blue-500" : isDark ? "bg-white/15" : "bg-slate-200"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform",
            checked ? "left-5" : "left-0.5"
          )}
        >
          {checked && (
            <Check className="h-3.5 w-3.5 text-blue-500" strokeWidth={3} />
          )}
        </span>
      </button>
    </div>
  )
}

const AUDIT_ROWS = [
  { id: "1", actor: "sarah.k@acme.com", action: "Role changed", target: "mazen salah → Manager", when: "Today, 9:14 AM", ip: "203.0.113.42" },
  { id: "2", actor: "system", action: "SSO session issued", target: "Okta · Mahmoud Emad", when: "Today, 8:02 AM", ip: "198.51.100.8" },
  { id: "3", actor: "joe.abraham@acme.com", action: "API key rotated", target: "Reporting integration", when: "Yesterday, 4:51 PM", ip: "192.0.2.17" },
  { id: "4", actor: "bella.j@acme.com", action: "2FA enforced", target: "Organization policy", when: "Mon, 11:22 AM", ip: "—" },
] as const

export function EnterpriseSecuritySettingsPage() {
  const { isDark } = useTheme()
  const [require2faOwners, setRequire2faOwners] = useState(true)
  const [require2faManagers, setRequire2faManagers] = useState(true)
  const [require2faMembers, setRequire2faMembers] = useState(false)
  const [ssoOnly, setSsoOnly] = useState(false)

  return (
    <div
      className={cn(
        "w-full max-w-5xl mx-auto pb-10 space-y-10",
        isDark ? "text-[#dce1fb]" : "text-slate-900"
      )}
    >
      <header className="flex flex-col gap-4 border-b pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl",
                isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-700"
              )}
            >
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className={cn("text-2xl font-bold tracking-tight", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Enterprise Security
              </h1>
              <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                Access reviews, authentication requirements, and audit visibility for your organization.
              </p>
            </div>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
            isDark ? "bg-white/10 text-emerald-300" : "bg-emerald-100 text-emerald-800"
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Security center
        </span>
      </header>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className={cn("h-5 w-5", isDark ? "text-blue-400" : "text-blue-600")} />
          <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Two-factor authentication
          </h2>
        </div>
        <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
          Require 2FA before members can access billing, payroll, or organization administration.
        </p>
        <div className="space-y-3">
          <ToggleRow
            isDark={isDark}
            label="Require for owners"
            description="Owners must use an authenticator app or security key."
            checked={require2faOwners}
            onChange={setRequire2faOwners}
          />
          <ToggleRow
            isDark={isDark}
            label="Require for managers"
            description="Applies to anyone with a manager role or project lead permissions."
            checked={require2faManagers}
            onChange={setRequire2faManagers}
          />
          <ToggleRow
            isDark={isDark}
            label="Require for all members"
            description="Includes contractors and part-time users. Recommended for regulated industries."
            checked={require2faMembers}
            onChange={setRequire2faMembers}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <GlobeLock className={cn("h-5 w-5", isDark ? "text-violet-400" : "text-violet-600")} />
          <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Sign-in & sessions
          </h2>
        </div>
        <ToggleRow
          isDark={isDark}
          label="SSO required for new sessions"
          description="When enabled, password-only logins are blocked. Configure your IdP under Organization settings."
          checked={ssoOnly}
          onChange={setSsoOnly}
        />
        <p className={cn("text-xs", isDark ? "text-white/35" : "text-slate-400")}>
          Session length and idle timeout follow your organization defaults.
        </p>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ScrollText className={cn("h-5 w-5", isDark ? "text-amber-400" : "text-amber-600")} />
          <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            Access audit log
          </h2>
        </div>
        <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
          Recent security-relevant events. Export is available to owners from the actions menu (demo UI).
        </p>
        <div
          className={cn(
            "overflow-hidden rounded-xl border",
            isDark ? "border-white/10" : "border-slate-200"
          )}
        >
          <div
            className={cn(
              "grid grid-cols-12 gap-2 border-b px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider",
              isDark ? "border-white/10 bg-white/3 text-white/45" : "border-slate-100 bg-slate-50 text-slate-500"
            )}
          >
            <span className="col-span-3">Actor</span>
            <span className="col-span-2">Action</span>
            <span className="col-span-3">Target</span>
            <span className="col-span-2">When</span>
            <span className="col-span-2">IP</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {AUDIT_ROWS.map(row => (
              <li
                key={row.id}
                className={cn(
                  "grid grid-cols-12 gap-2 px-4 py-3 text-sm",
                  isDark ? "bg-transparent" : "bg-white"
                )}
              >
                <span className={cn("col-span-3 truncate font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                  {row.actor}
                </span>
                <span className={cn("col-span-2", isDark ? "text-[#bccbb9]" : "text-slate-600")}>{row.action}</span>
                <span className={cn("col-span-3 truncate", isDark ? "text-[#bccbb9]" : "text-slate-600")}>{row.target}</span>
                <span className={cn("col-span-2 text-xs", isDark ? "text-white/45" : "text-slate-500")}>{row.when}</span>
                <span className={cn("col-span-2 font-mono text-xs", isDark ? "text-white/45" : "text-slate-500")}>
                  {row.ip}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

