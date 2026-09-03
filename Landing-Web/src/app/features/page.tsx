"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import { FEATURE_GROUPS, PRODUCT_DESCRIPTION } from "@/lib/product-content"

export default function FeaturesPage() {
  const [activeCategory, setActiveCategory] = useState<"all" | "time" | "activity" | "operations">("all")

  const categories = [
    { id: "all", label: "All Features" },
    { id: "time", label: "Time Tracking" },
    { id: "activity", label: "Activity Capture" },
    { id: "operations", label: "Operations Backbone" }
  ]

  const filteredFeatures = FEATURE_GROUPS.filter((group) => {
    if (activeCategory === "all") return true
    if (activeCategory === "time" && group.title.toLowerCase().includes("time")) return true
    if (activeCategory === "activity" && group.title.toLowerCase().includes("activity")) return true
    if (activeCategory === "operations" && group.title.toLowerCase().includes("operations")) return true
    return false
  })

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Features Overview"
          title="What the trial client ships today"
          description={PRODUCT_DESCRIPTION}
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-16">
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id as any)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all duration-200 cursor-pointer ${
                  activeCategory === cat.id
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {filteredFeatures.map((group) => {
              let iconPath = "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              let iconColor = "text-violet-600 bg-violet-50 border-violet-100"
              if (group.title.toLowerCase().includes("activity")) {
                iconPath = "M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
                iconColor = "text-emerald-600 bg-emerald-50 border-emerald-100"
              } else if (group.title.toLowerCase().includes("operations")) {
                iconPath = "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94-3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                iconColor = "text-blue-600 bg-blue-50 border-blue-100"
              }

              return (
                <div key={group.title} className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between animate-fadeIn">
                  <div>
                    <div className="flex items-center gap-3.5 mb-6">
                      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${iconColor}`}>
                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                        </svg>
                      </div>
                      <h2 className="text-lg font-bold text-slate-900">{group.title}</h2>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500 font-light mb-6">{group.description}</p>
                    <ul className="space-y-3 text-xs text-slate-600 font-light">
                      {group.points.map((point) => (
                        <li key={point} className="flex items-center gap-2.5">
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 flex-shrink-0">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            })}
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm">
            <h3 className="text-xl font-extrabold text-slate-900 mb-2">Development & Roadmap Status</h3>
            <p className="text-xs text-slate-500 font-light max-w-xl mb-8">
              Some capabilities exist on the backend and have dashboard visual interfaces, while other sections are on our short-term development queue.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { title: "Task Timer Client", status: "Active", desc: "Core web timer tracking, entry submissions to Firestore.", variant: "bg-emerald-50 text-emerald-700 border-emerald-100" },
                { title: "Desktop Agent Ingestion", status: "Active", desc: "Foreground app, active URL monitoring and screenshot captures.", variant: "bg-emerald-50 text-emerald-700 border-emerald-100" },
                { title: "Org Hierarchy Tree", status: "Active", desc: "Visual user node graphing and WebSocket real-time presence.", variant: "bg-emerald-50 text-emerald-700 border-emerald-100" },
                { title: "Timesheet Approvals", status: "Roadmap UI", desc: "Lead reconcile queues, approve/reject operations on API.", variant: "bg-amber-50 text-amber-700 border-amber-100" },
                { title: "Reports Hub", status: "Roadmap UI", desc: "Exportable CSV/PDF summaries for timesheet utilization grids.", variant: "bg-amber-50 text-amber-700 border-amber-100" },
                { title: "Command Center Hub", status: "Roadmap UI", desc: "Centralized charts, workspace billing configurations.", variant: "bg-amber-50 text-amber-700 border-amber-100" }
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-800">{item.title}</h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.variant}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500 font-light">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </PageShell>
  )
}
