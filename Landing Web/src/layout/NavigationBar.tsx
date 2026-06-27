"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

const Platform_TABS = [
  {
    label: "Hour logging",
    heading: "Clock in, track everything",
    subheading: "Precise time tracking built for distributed teams on any device.",
    features: [
      { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", title: "Smart timesheets", desc: "Auto-generate accurate timesheets from tracked sessions." },
      { icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", title: "Work summaries", desc: "Visual breakdowns of where team hours actually go." },
      { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M15 13l-3 3m0 0l-3-3m3 3V8", title: "Task-level logging", desc: "Log hours at project, task, and subtask granularity." },
      { icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z", title: "Location-based check-in", desc: "Auto clock-in when staff arrive at a job site." },
      { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", title: "Leave & absence tracking", desc: "Manage PTO, sick days, and shift availability in one view." },
    ],
    cta: { label: "Watch it live", useGradient: true, gradientText: "Try Virtual Tracker\nfree for 14 days 🚀", sub: "Maximize productivity with time tracking you can trust.", link: "Get started" },
  },
  {
    label: "Output visibility",
    heading: "See exactly how work happens",
    subheading: "Understand output and patterns — no micromanagement needed.",
    features: [
      { icon: "M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", title: "Team visibility", desc: "See who's online, what they're working on, and when." },
      { icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2", title: "Focus pattern analysis", desc: "Identify deep work windows and recurring interruptions." },
      { icon: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z", title: "Proof-of-work snapshots", desc: "Optional screenshots tied to active work sessions." },
      { icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Downtime detection", desc: "Flag idle gaps and understand where momentum drops." },
      { icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2", title: "Tool usage breakdown", desc: "See which apps and sites consume the most work time." },
    ],
    cta: { label: "Watch the walkthrough", useGradient: false, useVideo: true, sub: "Two minutes. See the whole product in motion.", link: "Check it out now" },
  },
  {
    label: "Workforce signals",
    heading: "Data-driven workforce decisions",
    subheading: "Convert raw work data into clear operational direction.",
    features: [
      { icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6", title: "Performance benchmarks", desc: "Compare output across individuals, teams, and time periods." },
      { icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064", title: "Hybrid work analysis", desc: "Measure output gaps between remote and on-site staff." },
      { icon: "M4 6h16M4 10h16M4 14h16M4 18h7", title: "Resource forecasting", desc: "Anticipate bandwidth needs before projects bottleneck." },
      { icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", title: "Custom reports", desc: "Build and export reports tailored to your business metrics." },
      { icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", title: "Anomaly alerts", desc: "Get notified when work patterns fall outside normal ranges." },
    ],
    cta: { label: "Explore live", useGradient: false, useVideo: true, sub: "Hands-on sandbox — no sign-up, no strings attached.", link: "Check it out now" },
  },
  {
    label: "Pay & invoicing",
    heading: "Hours tracked, people paid",
    subheading: "From logged minutes to invoices and global payments — automated.",
    features: [
      { icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M12 7h.01M9 7H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-2", title: "Budget tracking", desc: "Monitor project spend in real time against set budgets." },
      { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", title: "Client invoicing", desc: "Convert tracked hours into polished, accurate invoices." },
      { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", title: "Overtime rules", desc: "Apply custom overtime thresholds and pay multipliers." },
    ],
    cta: { label: "See it flow", useGradient: false, useVideo: true, sub: "Watch billing run itself from clock-out to payment.", link: "Check it out now" },
  },
  {
    label: "Connected apps",
    heading: "Plug into your existing stack",
    subheading: "35+ native integrations. Works with the tools your team already uses.",
    integrations: [
      { name: "Jira", color: "#0052CC" }, { name: "Slack", color: "#4A154B" }, { name: "Wise", color: "#37517E" },
      { name: "Deel", color: "#111827" }, { name: "Asana", color: "#F06A6A" }, { name: "Google Calendar", color: "#4285F4" },
      { name: "Trello", color: "#0052CC" }, { name: "Github", color: "#181717" }, { name: "ClickUp", color: "#7B68EE" },
      { name: "Zendesk", color: "#03363D" }, { name: "Quickbooks", color: "#2CA01C" }, { name: "Monday", color: "#F6592B" },
      { name: "Paypal", color: "#003087" }, { name: "Gusto", color: "#F45D48" }, { name: "Salesforce", color: "#00A1E0" },
    ],
    cta: { label: "Featured sync", useGradient: false, sub: "Streamline global payroll automatically with our Deel sync.", link: "Check it out now" },
  },
]

const SOLUTIONS_COLS = [
  {
    heading: "By industry",
    items: [
      { title: "Agencies", desc: "Manage campaigns, billable hours, client budgets, and project scopes." },
      { title: "Software teams", desc: "Hit milestones faster with workload management and time tracking." },
      { title: "Consulting", desc: "Track project timelines, billable hours, and streamline invoicing." },
      { title: "Healthcare", desc: "Monitor staff hours, compliance schedules, and shift coverage." },
    ],
    seeAll: "See all industries",
  },
  {
    heading: "By workforce",
    items: [
      { title: "Remote", desc: "Manage distributed teams of any size, across any timezone." },
      { title: "Field", desc: "Track time with geofencing and manage jobs in real-time." },
      { title: "Hybrid", desc: "Unify remote and in-office staff under one tracking layer." },
      { title: "Enterprise", desc: "Scale with enterprise-grade features, compliance, and support." },
    ],
  },
  {
    heading: "By model",
    items: [
      { title: "BPO", desc: "Boost efficiency and client satisfaction with targeted productivity insights." },
      { title: "Virtual assistants", desc: "Enhance task visibility and productivity with workload management." },
      { title: "Call centers", desc: "Elevate CX with streamlined employee management and metrics." },
      { title: "Freelancers", desc: "Log hours per client and generate invoices without the hassle." },
    ],
  },
]

const RESOURCES_COLS = [
  {
    heading: "Learn",
    items: [
      { title: "What we track", desc: "Transparency and control built into every layer of the platform." },
      { title: "Our principles", desc: "The values behind our approach to workforce and employee experience." },
      { title: "Help center", desc: "Support articles, walkthroughs, and setup guides." },
      { title: "FAQ", desc: "Quick answers to the most common questions about Virtual Tracker." },
    ],
  },
  {
    heading: "Explore",
    items: [
      { title: "Guides & tools", desc: "Practical resources for managers, teams, and operators." },
      { title: "Blog", desc: "Productivity tips, product news, and workplace insights." },
      { title: "Customer stories", desc: "How teams like yours use Virtual Tracker to get results." },
      { title: "Reviews", desc: "What our customers are saying across the web." },
    ],
  },
  {
    heading: "Connect",
    items: [
      { title: "Talk to sales", desc: "Explore tailored solutions with our team for your business needs." },
      { title: "Partners", desc: "Join us in building the future of how global work gets done." },
      { title: "Careers", desc: "Explore open roles and join a team that ships fast.", badge: "Hiring" },
    ],
  },
]

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DashboardPreview() {
  return (
    <div className="w-full h-36 rounded-xl overflow-hidden border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className="w-4 h-4 rounded bg-violet-100 flex items-center justify-center">
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-violet-600" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a1 1 0 011 1v3.5l2 2a1 1 0 11-1.4 1.4l-2.3-2.3A1 1 0 017 9V4a1 1 0 011-1z" />
          </svg>
        </div>
        <span className="text-[9px] font-bold text-slate-700">02:44:15</span>
      </div>
      <div className="p-2 grid grid-cols-2 gap-1.5">
        {[["$1,852.50", "Spent"], ["80:22:23", "Worked"], ["131:42", "This week"], ["81%", "Activity"]].map(([v, l]) => (
          <div key={l} className="bg-slate-50 rounded p-1.5">
            <div className="text-[8px] text-slate-400">{l}</div>
            <div className="text-[10px] font-bold text-slate-800">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlatformDropdown() {
  const [activeTab, setActiveTab] = useState(0)
  const tab = Platform_TABS[activeTab]

  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center" style={{ minHeight: 420 }}>
      <div className="flex w-full max-w-5xl">
        <div className="w-52 flex-shrink-0 border-r border-slate-100 py-4 px-3 flex flex-col justify-between">
          <div className="space-y-0.5">
            {Platform_TABS.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setActiveTab(i)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === i ? "bg-slate-100 text-[#0f172a]" : "text-slate-600 hover:bg-slate-50 hover:text-[#0f172a]"
                }`}
              >
                {t.label}
                {activeTab === i && <ArrowRight className="w-4 h-4 text-[#7c3aed] flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className="pt-4 border-t border-slate-100">
            <button className="flex items-center gap-2 text-sm font-medium text-[#7c3aed] hover:text-[#6d28d9]">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download the apps
            </button>
          </div>
        </div>

        <div className="flex-1 py-4 px-6">
          <div className="mb-3">
            <button className="flex items-center gap-2 text-base font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
              {tab.heading} <ArrowRight className="w-4 h-4 text-[#7c3aed]" />
            </button>
            <p className="text-xs text-slate-500 mt-0.5">{tab.subheading}</p>
          </div>
          <div className="border-t border-slate-100 mb-4" />

          {tab.integrations ? (
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              {tab.integrations.map(int => (
                <button key={int.name} className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-[#7c3aed] transition-colors text-left">
                  <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: int.color + "18" }}>
                    <span className="text-[8px] font-black" style={{ color: int.color }}>{int.name[0]}</span>
                  </div>
                  {int.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {tab.features!.map(f => (
                <div key={f.title} className="flex gap-2.5 cursor-pointer group">
                  <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#7c3aed]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={f.icon} />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#0f172a] group-hover:text-[#7c3aed] transition-colors">{f.title}</div>
                    <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <button className="flex items-center gap-1.5 text-sm font-semibold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
              {tab.integrations ? "See all integrations" : "See all features"} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="w-60 flex-shrink-0 border-l border-slate-100 py-4 px-5">
          <div className="text-sm font-bold text-[#0f172a] mb-3">{tab.cta.label}</div>
          {tab.cta.useGradient ? (
            <div className="w-full h-36 rounded-xl flex items-center justify-center p-4 mb-3" style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}>
              <p className="text-white text-lg font-extrabold text-center leading-snug whitespace-pre-line">{tab.cta.gradientText}</p>
            </div>
          ) : tab.cta.useVideo ? (
            <div className="w-full h-36 rounded-xl mb-3 overflow-hidden relative cursor-pointer group" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" }}>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors border border-white/20">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-white ml-0.5" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <span className="text-white/70 text-[10px] font-semibold tracking-wide uppercase">2 min overview</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#7c3aed] to-[#2563eb] opacity-60" />
            </div>
          ) : (
            <div className="mb-3"><DashboardPreview /></div>
          )}
          <p className="text-sm text-slate-600 leading-relaxed mb-3">{tab.cta.sub}</p>
          <button
            onClick={() => window.location.href = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000"}
            className="flex items-center gap-1.5 text-sm font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors cursor-pointer"
          >
            {tab.cta.link} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function SolutionsDropdown() {
  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center" style={{ minHeight: 380 }}>
      <div className="flex w-full max-w-5xl py-6 px-4 gap-6">
        <div className="flex flex-1 gap-6">
          {SOLUTIONS_COLS.map(col => (
            <div key={col.heading} className="flex-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{col.heading}</div>
              <div className="space-y-4">
                {col.items.map(item => (
                  <div key={item.title} className="cursor-pointer group">
                    <div className="text-sm font-semibold text-[#0f172a] group-hover:text-[#7c3aed] transition-colors">{item.title}</div>
                    <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
              {col.seeAll && (
                <button className="flex items-center gap-1 text-sm font-semibold text-[#0f172a] hover:text-[#7c3aed] transition-colors mt-5">
                  {col.seeAll} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="w-60 flex-shrink-0 border-l border-slate-100 pl-6">
          <div className="text-sm font-bold text-[#0f172a] mb-3">Customer stories</div>
          <div className="w-full h-36 rounded-xl overflow-hidden mb-3 bg-slate-100 flex items-center justify-center">
            <div className="text-center px-4">
              <div className="w-10 h-10 rounded-full bg-[#7c3aed]/10 flex items-center justify-center mx-auto mb-2">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#7c3aed]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-xs text-slate-500 leading-snug">Real teams. Real results.</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">Affordable Staff saved $4.2M over 12 years using Virtual Tracker.</p>
          <button className="flex items-center gap-1.5 text-sm font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
            Explore customer stories <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ResourcesDropdown() {
  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center" style={{ minHeight: 380 }}>
      <div className="flex w-full max-w-5xl py-6 px-4 gap-6">
        <div className="flex flex-1 gap-6">
          {RESOURCES_COLS.map(col => (
            <div key={col.heading} className="flex-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{col.heading}</div>
              <div className="space-y-4">
                {col.items.map(item => (
                  <div key={item.title} className="cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-[#0f172a] group-hover:text-[#7c3aed] transition-colors">{item.title}</div>
                      {item.badge && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{item.badge}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="w-60 flex-shrink-0 border-l border-slate-100 pl-6">
          <div className="text-sm font-bold text-[#0f172a] mb-3">Featured resource</div>
          <div className="w-full h-36 rounded-xl overflow-hidden mb-3 flex items-end p-3" style={{ background: "linear-gradient(135deg, #312e81 0%, #1e40af 60%, #065f46 100%)" }}>
            <p className="text-white text-sm font-extrabold leading-tight">The 2026 Global Trends & Benchmarks Report</p>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">Ready to see how your team stacks up? Read our new 2026 Global Work Report.</p>
          <button className="flex items-center gap-1.5 text-sm font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
            Download now <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

type OpenMenu = "Platform" | "solutions" | "resources" | null

export default function NavigationBar() {
  const router = useRouter()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState<OpenMenu>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const toggle = (menu: OpenMenu) => setOpen(prev => prev === menu ? null : menu)

  const isTransparent = !scrolled && !open
  const btnBg = isTransparent ? "bg-white text-black hover:bg-white/90" : "bg-[#1e293b] text-white hover:bg-[#0f172a]"

  const navBtnClass = (menu: OpenMenu) =>
    `flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
      open === menu
        ? "text-[#7c3aed] bg-violet-50"
        : isTransparent
        ? "text-white/80 hover:text-white hover:bg-white/10"
        : "text-[#374151] hover:text-[#0f172a] hover:bg-slate-50"
    }`

  const chevronClass = (menu: OpenMenu) =>
    `w-3.5 h-3.5 transition-transform duration-200 ${
      open === menu ? "rotate-180 text-[#7c3aed]" : isTransparent ? "text-white/60" : "text-slate-400"
    }`

  return (
    <nav
      ref={navRef}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isTransparent ? "bg-transparent" : "bg-white/95 backdrop-blur-md"
      }`}
      style={{ overflow: "visible" }}
    >
      <svg className="absolute w-0 h-0 pointer-events-none">
        <defs>
          <filter id="gooey-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="gooey" />
            <feComposite in="SourceGraphic" in2="gooey" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* Nav bar row — z-60 so it always paints above the dropdown (z-40) */}
      <div className="relative z-60 max-w-full px-16 h-16 flex items-center justify-between" style={{ overflow: "visible" }}>
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
            <img src={isTransparent ? "/stopwatch-green.png" : "/stopwatch-black.png"} alt="Virtual Tracker" className="w-8 h-8" />
          </div>
          <span className={`font-bold text-lg tracking-tight ${isTransparent ? "text-white" : "text-[#0f172a]"}`}>Virtual Tracker</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          <button onClick={() => toggle("Platform")} className={navBtnClass("Platform")}>
            Platform <ChevronDown className={chevronClass("Platform")} />
          </button>
          <button onClick={() => toggle("solutions")} className={navBtnClass("solutions")}>
            Solutions <ChevronDown className={chevronClass("solutions")} />
          </button>
          <button onClick={() => toggle("resources")} className={navBtnClass("resources")}>
            Resources <ChevronDown className={chevronClass("resources")} />
          </button>

          <div className={`w-px h-5 mx-2 ${isTransparent ? "bg-white/20" : "bg-slate-200"}`} />
          <Link href="/pricing" className={`px-3 py-2 text-sm font-medium transition-colors ${isTransparent ? "text-white/80 hover:text-white" : "text-[#374151] hover:text-[#0f172a]"}`}>
            Pricing
          </Link>
          <Link href="/demo" className={`px-3 py-2 text-sm font-medium transition-colors ${isTransparent ? "text-white/80 hover:text-white" : "text-[#374151] hover:text-[#0f172a]"}`}>
            Demo
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-16" style={{ overflow: "visible" }}>
          {/* Try now — isolated from gooey filter so its box-shadow glow is never clipped */}
          <button
            onClick={() => window.location.href = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000"}
            className="relative inline-flex items-center gap-2 rounded-full font-semibold text-sm px-5 py-2.5 cursor-pointer bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-colors"
            style={{ boxShadow: "0 0 28px 8px rgba(124,58,237,0.5), 0 0 10px 3px rgba(124,58,237,0.3)" }}
          >
            Try now
          </button>
          <div
            className="relative flex items-center group cursor-pointer"
            style={{ filter: "url(#gooey-filter)" }}
            onClick={() => window.location.href = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000"}
          >
            <button className={`absolute right-0 px-3 rounded-full font-semibold text-sm transition-all duration-300 cursor-pointer h-10 flex items-center justify-center -translate-x-12 group-hover:-translate-x-[6.5rem] z-0 ${btnBg}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </button>
            <button className={`px-8 py-2.5 rounded-full font-semibold text-sm transition-all duration-300 cursor-pointer h-10 flex items-center z-10 ${btnBg}`}>
              Sign in
            </button>
          </div>
        </div>

        <button className="md:hidden p-2">
          <div className={`w-5 h-0.5 mb-1 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
          <div className={`w-5 h-0.5 mb-1 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
          <div className={`w-5 h-0.5 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
        </button>
      </div>

      {/* Dropdowns sit behind the nav row */}
      {open === "Platform" && <PlatformDropdown />}
      {open === "solutions" && <SolutionsDropdown />}
      {open === "resources" && <ResourcesDropdown />}
    </nav>
  )
}