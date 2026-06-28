"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import { PRODUCT_TAGLINE } from "@/lib/product-content"

export default function AboutPage() {
  const [activeLayer, setActiveLayer] = useState(0)

  const pillars = [
    {
      title: "Backend-Enforced Security",
      desc: "Every database query enforces role clearance and email verification checks before allowing read/write operations.",
      color: "from-violet-500 to-indigo-600",
      icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    },
    {
      title: "Hierarchy-Aware Visibility",
      desc: "Managers can inspect screenshot feeds and application logs for their direct reports, while members maintain isolated dashboards.",
      color: "from-blue-500 to-cyan-500",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
    },
    {
      title: "Accountable Activity",
      desc: "Screenshots, foreground window titles, and browser addresses are captured on random intervals only while the timer is active.",
      color: "from-emerald-500 to-teal-500",
      icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    }
  ]

  const archLayers = [
    {
      name: "Next.js Web Dashboard",
      role: "User-facing dashboard interfaces, team organization trees, client CRUD tables, and project boards.",
      tech: "Next.js 15, React 19, Tailwind CSS v4",
      files: ["src/app/* (App router pages)", "src/features/* (Workspace layouts)", "src/layout/NavigationBar.tsx"],
      endpoints: ["Uses client-side Firebase SDK for auth/presence", "Queries API server on port 5712 for activity payloads"]
    },
    {
      name: "Node.js Express Server",
      role: "Backend coordinator running on port 5712. Encrypts activity payloads, registers desktop tokens, and validates organization parameters.",
      tech: "Node.js, Express, Firebase Admin SDK",
      files: ["server/index.js (App initiation)", "server/routes/activity.js (Ingest routing)", "server/middleware/auth.js"],
      endpoints: ["POST /api/activity/agent/link (Linking flow)", "POST /api/activity/ingest (Payload capture)"]
    },
    {
      name: "Firebase Cloud Storage",
      role: "Main domain and dynamic database layers. Firestore stores collections, RTDB manages presence, Storage handles snapshots.",
      tech: "Google Cloud, Firestore Collections, Firebase Storage",
      files: ["firestore.rules (Permission validations)", "storage.rules (File access scopes)", "RTDB nodes (Presence sync)"],
      endpoints: ["/users/{userId} (Member records)", "/activities/{activityId} (Processed activity details)"]
    },
    {
      name: "Python Ingestion Client",
      role: "Native operating system background worker. Captures screenshots, records active windows, and extracts active address URLs.",
      tech: "Python 3, PyAutoGUI, OpenCV, SQLite",
      files: ["app/Python-App-Extension/main.py", "app/Python-App-Extension/capturer.py", "app/Python-App-Extension/url_grabber.py"],
      endpoints: ["Pairs via client-side token exchanges", "Sends secure JSON arrays to the Node.js API ingest endpoints"]
    }
  ]

  const milestones = [
    { year: "Phase 1", title: "Core Timer & Authentication", desc: "Built Firebase email verification gates, task-linked timer tracking, and timesheet logs sync." },
    { year: "Phase 2", title: "Desktop Extension Ingest", desc: "Released the native Python capture agent with secure code linking and background application capture." },
    { year: "Phase 3", title: "Role Hierarchies", desc: "Enforced Firestore security rules ensuring visibility controls are mapped to team manager paths." }
  ]

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="About Virtual Tracker"
          title={PRODUCT_TAGLINE}
          description="Virtual Tracker models a secure distributed tracking infrastructure, combining desktop activity agents with Firebase web interfaces."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-16 space-y-20">
          {/* Pillars section */}
          <section className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="group relative rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm hover:shadow-md hover:border-violet-200 transition-all duration-300">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${pillar.color} flex items-center justify-center text-white mb-6 group-hover:scale-105 transition-transform duration-300 shadow-md`}>
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d={pillar.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-violet-700 transition-colors duration-200">{pillar.title}</h3>
                <p className="mt-4 text-xs leading-relaxed text-slate-500 font-light">{pillar.desc}</p>
              </div>
            ))}
          </section>

          {/* Interactive Architecture Section */}
          <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-100/50 rounded-full blur-3xl -z-10" />
            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 mb-2">Technical Architecture</h2>
            <p className="text-slate-500 text-xs md:text-sm max-w-2xl font-light mb-12">
              Explore the functional components of the Virtual Tracker stack. Click on any architecture layer below to inspect its role and target code files.
            </p>

            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] items-start">
              {/* Layer Selection */}
              <div className="space-y-3">
                {archLayers.map((layer, idx) => (
                  <button
                    key={layer.name}
                    onClick={() => setActiveLayer(idx)}
                    className={`w-full text-left p-5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between ${
                      activeLayer === idx
                        ? "bg-violet-50/70 border-violet-300 text-violet-900 shadow-sm"
                        : "bg-slate-50/40 border-slate-100 hover:bg-slate-50/80 text-slate-700 hover:border-slate-200"
                    }`}
                  >
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Layer 0{idx + 1}</div>
                      <h4 className="text-sm font-extrabold mt-0.5">{layer.name}</h4>
                    </div>
                    {activeLayer === idx && (
                      <div className="w-2.5 h-2.5 rounded-full bg-violet-600 animate-pulse" />
                    )}
                  </button>
                ))}
              </div>

              {/* Layer Detail Display */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-6 md:p-8 space-y-6 min-h-[300px] flex flex-col justify-between backdrop-blur-sm">
                <div className="space-y-4">
                  <div>
                    <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Active Component
                    </span>
                    <h3 className="text-lg font-bold text-slate-900 mt-2">{archLayers[activeLayer].name}</h3>
                  </div>

                  <p className="text-xs text-slate-500 font-light leading-relaxed">
                    {archLayers[activeLayer].role}
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2 pt-2">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Technology</span>
                      <p className="text-xs text-slate-700 font-semibold">{archLayers[activeLayer].tech}</p>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Key Files</span>
                      <ul className="space-y-1 text-xs text-slate-600 font-light font-mono">
                        {archLayers[activeLayer].files.map((file) => (
                          <li key={file} className="truncate">{file}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200/60 pt-4 mt-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Communication Endpoints</span>
                  <ul className="space-y-1 text-[11px] text-slate-600 font-light mt-1.5 list-disc pl-4 leading-relaxed">
                    {archLayers[activeLayer].endpoints.map((ep) => (
                      <li key={ep}>{ep}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Development Milestone Timeline */}
          <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm max-w-4xl mx-auto">
            <h3 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-10 text-center">Development Roadmap Milestones</h3>
            <div className="relative border-l border-slate-200 pl-8 ml-4 space-y-10">
              {milestones.map((ms, idx) => (
                <div key={idx} className="relative group">
                  <div className="absolute -left-[41px] top-1.5 w-6 h-6 rounded-full border-4 border-white bg-slate-200 group-hover:bg-violet-600 transition-colors duration-200" />
                  <div className="text-xs font-bold text-violet-600 font-mono uppercase tracking-wider">{ms.year}</div>
                  <h4 className="text-base font-bold text-slate-800 mt-1">{ms.title}</h4>
                  <p className="text-xs text-slate-500 font-light leading-relaxed mt-2">{ms.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </PageShell>
  )
}
