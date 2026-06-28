"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"

export default function SolutionsPage() {
  const [selectedSegment, setSelectedSegment] = useState<string>("remote")

  const segments = [
    {
      id: "remote",
      title: "Remote Operations",
      desc: "Enable accountability and visibility across distributed teams without friction or constant micromanaging, utilizing direct background activity flows.",
      metrics: [
        { label: "Activity Capture Accuracy", value: "99.9%" },
        { label: "Real-time Presence Latency", value: "< 250ms" }
      ],
      points: ["Random interval screenshot uploads", "Web socket presence statuses", "Foreground process tracking logs"],
      color: "text-violet-600 bg-violet-50 border-violet-100",
      icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
    },
    {
      id: "client",
      title: "Client Services",
      desc: "Keep project margins clear. Direct time trackers link task logs straight to client budgets, creating auditable records of team outputs.",
      metrics: [
        { label: "Billing Audit Rate", value: "100%" },
        { label: "Client Report Generation", value: "Instant" }
      ],
      points: ["Task-linked timer submissions", "Client budget threshold cap warnings", "Auditable task review queues"],
      color: "text-blue-600 bg-blue-50 border-blue-100",
      icon: "M12 6v12m-3-2.818l.879.879A3 3 0 0012.243 17h.12a3 3 0 002.83-2H12m0 0V3.75m0 9.03a3 3 0 01-4.07-3.078H12m0 0H9m3 0c.85 0 1.56.58 1.77 1.365L14 11"
    },
    {
      id: "lead",
      title: "Team Leads & Managers",
      desc: "Consolidate member tracking logs, app usage histories, and drag-and-drop task boards into a single organizational control dashboard.",
      metrics: [
        { label: "Dashboard Load Time", value: "< 180ms" },
        { label: "Manager Sync Rate", value: "Real-time" }
      ],
      points: ["Role-scoped activity feeds access", "Timesheet approval/reject endpoints", "Visual member tree mapping"],
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
      icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.109A11.386 11.386 0 0110.089 21c-2.243 0-4.34-.647-6.11-1.758v-.109a4.125 4.125 0 017.533-2.493M14.214 9.75a3.987 3.987 0 00.316-1.5 4 4 0 10-7.544 1.947M6.75 7.5a3 3 0 11-6 0 3 3 0 016 0zm6.303 6.643L13.5 15H15M9 15h.008v.008H9V15z"
    },
    {
      id: "trial",
      title: "Trial Deployments",
      desc: "Evaluate in minutes. Clone the codebase and deploy on a sandbox database using Firebase Authentication and local launch orchestrators.",
      metrics: [
        { label: "Setup Configuration Limit", value: "0 Fee" },
        { label: "API Linking Pairing Time", value: "< 1 min" }
      ],
      points: ["Google & Password auth support", "Pre-provisioned member onboarding", "SQLite fallback client logs"],
      color: "text-amber-600 bg-amber-50 border-amber-100",
      icon: "M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
    }
  ]

  const activeData = segments.find(s => s.id === selectedSegment) ?? segments[0]

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Solutions"
          title="Where Virtual Tracker fits"
          description="Virtual Tracker models workflow coordination for different operational layers, keeping activity data secure and accountable."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-12">
          {/* Segment selectors */}
          <div className="flex flex-wrap justify-center gap-2">
            {segments.map((segment) => (
              <button
                key={segment.id}
                onClick={() => setSelectedSegment(segment.id)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all duration-200 cursor-pointer ${
                  selectedSegment === segment.id
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {segment.title}
              </button>
            ))}
          </div>

          {/* Interactive display board */}
          <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm grid gap-8 lg:grid-cols-[1.2fr_0.8fr] items-center min-h-[380px]">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${activeData.color}`}>
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d={activeData.icon} />
                  </svg>
                </div>
                <h3 className="text-xl font-extrabold text-slate-900">{activeData.title}</h3>
              </div>

              <p className="text-xs md:text-sm text-slate-500 font-light leading-relaxed max-w-xl">
                {activeData.desc}
              </p>

              <div className="border-t border-slate-100 pt-6 space-y-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Target Deliverables</span>
                <ul className="space-y-2 text-xs text-slate-600 font-light list-disc pl-4">
                  {activeData.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Metrics column */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6 md:p-8 space-y-6">
              <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Operational Metrics
              </span>
              <div className="space-y-6">
                {activeData.metrics.map((metric) => (
                  <div key={metric.label} className="space-y-1">
                    <div className="text-2xl font-black text-slate-900 tracking-tight">{metric.value}</div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </PageShell>
  )
}
