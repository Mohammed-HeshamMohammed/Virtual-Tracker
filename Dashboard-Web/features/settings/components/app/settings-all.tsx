"use client"

import { useEffect } from "react"
import { cn } from "@/shared/utils/utils"

interface SettingsCard {
  icon: string
  title: string
  description: string
  link: string
  navigateTo: string | null
  iconWrapClass?: string
  iconClass?: string
}

const cards: SettingsCard[] = [
  { icon: "table_chart",    title: "Organization Settings", description: "General details, company branding, work week cycles, and global security policies.", link: "Manage settings",      navigateTo: "settings-organization" },
  { icon: "groups",         title: "Members",               description: "Invite new members to your organization, manage roles, and view invitation status.",  link: "Manage members",      navigateTo: "settings-members"      },
  { icon: "assignment",     title: "Projects",              description: "Configure global project settings, budgeting defaults, and tracking requirements.",    link: "Manage projects",     navigateTo: "pm-projects"           },
  { icon: "calendar_today", title: "Schedules",             description: "Shift management, corporate holidays, time-off policies, and attendance tracking.",   link: "Manage schedules",    navigateTo: "settings-schedules"    },
  { icon: "timer",          title: "Activity & Tracking", description: "Configure timesheets, activity tracking, screenshots, URLs, and app monitoring.",    link: "Manage tracking",     navigateTo: "settings-activity",     iconWrapClass: "bg-blue-50 group-hover:bg-blue-100/90", iconClass: "text-blue-600" },
  { icon: "payments",       title: "Billing",               description: "Review subscription plans, update payment methods, and download past invoices.",      link: "Manage billing",      navigateTo: "settings-billing"      },
  { icon: "hub",            title: "Integrations",          description: "Connect with third-party tools like Slack, Jira, Trello, and GitHub.",               link: "Manage integrations", navigateTo: "settings-integrations" },
  { icon: "description",    title: "Policies",              description: "Time off accrual schedules, paid and unpaid rules, and who is covered by each policy.", link: "Manage policies",   navigateTo: "settings-policies",     iconWrapClass: "bg-amber-50 group-hover:bg-amber-100/90", iconClass: "text-amber-600" },
]

export function SettingsAllPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  useEffect(() => {
    const id = "material-symbols-font"
    if (!document.getElementById(id)) {
      const link = document.createElement("link")
      link.id = id
      link.rel = "stylesheet"
      link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
      document.head.appendChild(link)
    }
  }, [])

  return (
    <>
      <style>{`
        .ms-icon {
          font-family: 'Material Symbols Outlined';
          font-weight: normal;
          font-style: normal;
          font-size: 22px;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          display: inline-block;
          white-space: nowrap;
          word-wrap: normal;
          direction: ltr;
          font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;
          -webkit-font-smoothing: antialiased;
        }
        .ms-icon-filled { font-variation-settings: 'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24; }
      `}</style>

      <div className="p-8 max-w-7xl mx-auto">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.map(({ icon, title, description, link, navigateTo, iconWrapClass, iconClass }) => (
            <div
              key={title}
              onClick={() => navigateTo && onNavigate(navigateTo)}
              className={cn(
                "group bg-white rounded-2xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border border-black/4",
                navigateTo ? "cursor-pointer" : "cursor-default"
              )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
            >
              <div className="flex justify-between items-start mb-5">
                <div
                  className={cn(
                    "w-11 h-11 rounded-xl flex items-center justify-center transition-colors",
                    iconWrapClass ?? "bg-[#eaedff] group-hover:bg-[#6b38d4]/10"
                  )}
                >
                  <span className={cn("ms-icon", iconClass ?? "text-[#6b38d4]")}>{icon}</span>
                </div>
                <span className="ms-icon text-[#3d4a3d]/30 group-hover:text-[#006e2f] transition-colors">chevron_right</span>
              </div>
              <h3 className="text-base font-bold text-[#131b2e] mb-2">{title}</h3>
              <p className="text-sm text-[#3d4a3d] leading-relaxed mb-6">{description}</p>
              <span className="text-sm font-semibold text-[#006e2f] group-hover:underline underline-offset-4 decoration-2" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>{link}</span>
            </div>
          ))}

          <div className="group bg-[#006e2f] rounded-2xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 flex flex-col justify-between overflow-hidden relative cursor-pointer"
               onClick={() => onNavigate("settings-enterprise-security")}>
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-5">
                <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
                  <span className="ms-icon ms-icon-filled text-white">security</span>
                </div>
                <span className="px-3 py-1 bg-white/20 rounded-full text-[10px] font-bold tracking-widest uppercase text-white">Security Audit</span>
              </div>
              <h3 className="text-base font-bold text-white mb-2">Enterprise Security</h3>
              <p className="text-sm text-white/80 leading-relaxed mb-6">View detailed access logs and manage 2FA requirements across your organization.</p>
            </div>
            <button className="relative z-10 w-full py-2.5 bg-white text-[#006e2f] rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors" type="button">
              Launch Security Center
            </button>
            <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          </div>
        </div>

        <section className="mt-10 p-7 bg-[#eaedff] rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h4 className="text-[#131b2e] font-bold text-base">System Health</h4>
            <p className="text-[#3d4a3d] text-sm mt-0.5">All integration services are operational. Last sync: 2 mins ago.</p>
          </div>
          <div className="flex gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-black/4">
              <span className="w-2 h-2 rounded-full bg-[#006e2f] shadow-[0_0_8px_rgba(0,110,47,0.5)]" />
              <span className="text-xs font-bold text-[#131b2e]">Cloud Status</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-black/4">
              <span className="w-2 h-2 rounded-full bg-[#4236e6] shadow-[0_0_8px_rgba(66,54,230,0.5)]" />
              <span className="text-xs font-bold text-[#131b2e]">v2.4.0 (Stable)</span>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

