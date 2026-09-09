"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import AppCtaLink from "@/components/AppCtaLink"
import { getTrialHref } from "@/lib/site-urls"
import { SLUG_PAGES } from "@/lib/product-content"

const DEFAULT_PAGE = {
  title: "Page not found",
  description: "This page is not part of the Virtual Tracker marketing site. Try Features, Demo, or Contact.",
  bullets: ["Features overview", "Product demo", "Contact"],
}

export default function CatchAllPage({ params }: { params: React.Usable<{ slug?: string[] }> }) {
  const resolvedParams = React.use(params)
  const path = Array.isArray(resolvedParams.slug) ? resolvedParams.slug.filter(Boolean).join("/") : ""
  const page = (path && SLUG_PAGES[path]) || DEFAULT_PAGE

  const [time, setTime] = useState(0)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    let interval: any
    if (isRunning) {
      interval = setInterval(() => {
        setTime((prev) => prev + 1)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isRunning])

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, "0")
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")
    const secs = (seconds % 60).toString().padStart(2, "0")
    return `${hrs}:${mins}:${secs}`
  }

  const [terminalTab, setTerminalTab] = useState<"install" | "run" | "logs">("install")

  const [tasks, setTasks] = useState([
    { id: 1, text: "Refactor database permission gates", status: "todo" },
    { id: 2, text: "Verify Python OpenCV screen capturing", status: "progress" },
    { id: 3, text: "Design premium subpage user interfaces", status: "done" }
  ])

  const moveTask = (id: number) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        const nextStatus = t.status === "todo" ? "progress" : t.status === "progress" ? "done" : "todo"
        return { ...t, status: nextStatus }
      }
      return t
    }))
  }

  const [activeDept, setActiveDept] = useState<"dev" | "design">("dev")

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Platform Feature"
          title={page.title}
          description={page.description}
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-16">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {page.bullets.map((bullet) => (
              <div key={bullet} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-all duration-300 flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-600 flex-shrink-0">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800">{bullet}</h4>
                  <p className="text-xs text-slate-500 font-light leading-relaxed">
                    Designed to work with the pilot version of our time tracking API and secure Firestore database connections.
                  </p>
                </div>
              </div>
            ))}
          </div>

          {path === "time-tracking" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm text-center max-w-xl mx-auto space-y-6">
              <h3 className="text-lg font-bold text-slate-900">Task Timer Sandbox</h3>
              <p className="text-xs text-slate-400 font-light max-w-sm mx-auto">
                Test starting and pausing a task-linked timer session. Real dashboard hours feed directly into Firestore logs.
              </p>
              
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 space-y-4 max-w-xs mx-auto">
                <div className="text-3xl font-black text-slate-950 font-mono tracking-wider">{formatTime(time)}</div>
                <button
                  onClick={() => setIsRunning(!isRunning)}
                  className={`w-full py-2.5 rounded-full text-xs font-bold shadow transition-all cursor-pointer ${
                    isRunning ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-violet-600 hover:bg-violet-700 text-white"
                  }`}
                >
                  {isRunning ? "Pause Session" : "Start Session Timer"}
                </button>
              </div>
            </section>
          )}

          {path === "desktop-agent" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm max-w-2xl mx-auto space-y-6">
              <h3 className="text-lg font-bold text-slate-900 text-center">Interactive Installation Console</h3>
              <div className="flex justify-center gap-2 mb-4">
                {["install", "run", "logs"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTerminalTab(tab as any)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      terminalTab === tab
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {tab === "install" ? "1. Install" : tab === "run" ? "2. Execute" : "3. Ingest Logs"}
                  </button>
                ))}
              </div>

              <div className="bg-slate-950 text-slate-200 p-5 rounded-2xl font-mono text-xs space-y-3 min-h-[140px] shadow-inner select-all">
                {terminalTab === "install" && (
                  <div className="space-y-1 text-slate-300">
                    <div><span className="text-slate-500"># Install libraries via package managers</span></div>
                    <div>$ pip install pyautogui opencv-python requests</div>
                    <div><span className="text-emerald-500">✓ Libraries installed successfully.</span></div>
                  </div>
                )}
                {terminalTab === "run" && (
                  <div className="space-y-1 text-slate-300">
                    <div><span className="text-slate-500"># Run the extension helper using linked client code</span></div>
                    <div>$ python main.py --token=VT_TRIAL_X82A</div>
                    <div><span className="text-emerald-500">✓ Ingestion client connected to port 5712.</span></div>
                  </div>
                )}
                {terminalTab === "logs" && (
                  <div className="space-y-1 text-slate-400">
                    <div>[09:42:15] <span className="text-violet-400">Linked to dashboard auth</span></div>
                    <div>[09:43:45] Active process: VS Code (activity.md)</div>
                    <div>[09:43:47] Random screenshot uploaded to Firestore/Storage bucket</div>
                    <div>[09:45:15] Active process: Chrome (console.firebase.google.com)</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {path === "projects-tasks" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm max-w-2xl mx-auto space-y-6">
              <h3 className="text-lg font-bold text-slate-900 text-center">Interactive Task Boards</h3>
              <p className="text-xs text-slate-400 font-light text-center max-w-md mx-auto">
                Click on the tasks below to cycle them through board swimlanes (Todo &rarr; Progress &rarr; Done).
              </p>

              <div className="grid gap-4 md:grid-cols-3">
                {["todo", "progress", "done"].map((col) => (
                  <div key={col} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                      {col === "todo" ? "To Do" : col === "progress" ? "In Progress" : "Completed"}
                    </span>
                    <div className="space-y-2">
                      {tasks.filter(t => t.status === col).map((task) => (
                        <button
                          key={task.id}
                          onClick={() => moveTask(task.id)}
                          className="w-full text-left p-3 rounded-xl border border-slate-200 bg-white hover:border-violet-300 hover:shadow-sm transition-all text-xs font-semibold text-slate-800 cursor-pointer"
                        >
                          {task.text}
                          <div className="mt-2 text-[9px] text-violet-600 font-normal">Click to shift &rarr;</div>
                        </button>
                      ))}
                      {tasks.filter(t => t.status === col).length === 0 && (
                        <div className="text-[11px] text-slate-400 font-light text-center py-6 border border-dashed border-slate-200 rounded-xl">
                          No tasks
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {path === "people-teams" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm max-w-2xl mx-auto space-y-6">
              <h3 className="text-lg font-bold text-slate-900 text-center">WebSocket Real-Time Presence</h3>
              <div className="flex justify-center gap-2 mb-4">
                {["dev", "design"].map((dept) => (
                  <button
                    key={dept}
                    onClick={() => setActiveDept(dept as any)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      activeDept === dept
                        ? "bg-violet-600 border-violet-600 text-white"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {dept === "dev" ? "Development Team" : "Creative & Design"}
                  </button>
                ))}
              </div>

              <div className="space-y-2 max-w-md mx-auto">
                {activeDept === "dev" ? (
                  <>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-slate-800">Alex Rivera</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">WS latency: 42ms</div>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-slate-800">Jamie Chen</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">WS latency: 85ms</div>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                  </>
                ) : (
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-slate-800">Sarah Jenkins</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">WS latency: 31ms</div>
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-50/50 via-slate-50/30 to-blue-50/50 -z-10" />
            <h3 className="text-xl font-extrabold text-slate-900 mb-2">Test this feature live</h3>
            <p className="text-xs text-slate-500 font-light max-w-md mx-auto mb-6">
              Launch our pre-configured evaluation workspace to see how role hierarchies and data limits apply to {page.title.toLowerCase()}.
            </p>
            <AppCtaLink
              href={getTrialHref()}
              className="inline-flex items-center rounded-full bg-violet-600 px-6 py-3 text-xs font-bold text-white hover:bg-violet-700 shadow-md transition-all duration-200 cursor-pointer"
            >
              Open Sandbox Dashboard &rarr;
            </AppCtaLink>
          </div>
        </div>
      </main>
    </PageShell>
  )
}
