"use client"

import { useEffect, useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import AppCtaLink from "@/components/AppCtaLink"
import { getSignInHref } from "@/lib/site-urls"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { fetchMyActivitySummary, type MyActivitySummary } from "@/lib/api/dashboard-general"

export default function DemoPage() {
  const [activeScreen, setActiveScreen] = useState<"people" | "projects" | "activity" | "timesheets">("timesheets")
  const { user } = useCurrentUser()
  const [mySummary, setMySummary] = useState<MyActivitySummary | null>(null)

  useEffect(() => {
    if (!user) {
      setMySummary(null)
      return
    }
    let cancelled = false
    void fetchMyActivitySummary().then((result) => {
      if (!cancelled) setMySummary(result)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  const personalized = Boolean(user && mySummary && (mySummary.todos.length > 0 || mySummary.recentProjects.length > 0))

  const screens = {
    timesheets: {
      title: "Timesheets Workspace",
      desc: personalized
        ? "Your own open tasks, pulled live from your account."
        : "Track work hours against specific tasks. Leads review logs in the approvals queue.",
      logs:
        personalized && mySummary
          ? mySummary.todos.slice(0, 3).map((task) => ({
              task: task.title,
              time: task.priority ? `Priority: ${task.priority}` : "",
              status: task.status,
              project: task.projectName,
            }))
          : [
              { task: "Designing landing page subpages", time: "2 hrs 40 mins", status: "Approved", project: "Virtual Tracker Web" },
              { task: "Implementing active window process logging", time: "3 hrs 15 mins", status: "Pending", project: "Python Desktop Extension" },
              { task: "Refactoring Firestore security rule constraints", time: "1 hr 10 mins", status: "Approved", project: "Database Security" }
            ]
    },
    people: {
      title: "People & Organization Hierarchy",
      desc: "Visualize your entire team tree structure. System visibility boundaries are derived from these paths.",
      members: [
        { name: "Mohammed Hesham", role: "Org Owner / Administrator", active: true },
        { name: "Sarah Jenkins", role: "Design Lead / Manager", active: true },
        { name: "Alex Rivera", role: "Frontend Developer / Member", active: false }
      ]
    },
    projects: {
      title: "Projects & Clients Dashboard",
      desc: personalized
        ? "Your own recent projects, pulled live from your account."
        : "Organize clients, coordinate deliverables, and inspect live budget usage.",
      items:
        personalized && mySummary
          ? mySummary.recentProjects.slice(0, 4).map((project) => ({
              client: project.name,
              project: `${project.progress}% complete`,
              budget: `${project.memberCount} members`,
              spent: "",
            }))
          : [
              { client: "Acme Corp", project: "SaaS Launch V2", budget: "$12,000", spent: "$4,500" },
              { client: "Globex Dynamics", project: "Desktop Extension Setup", budget: "$6,500", spent: "$1,200" }
            ]
    },
    activity: {
      title: "Activity Ingestion Feed",
      desc: "Pushed by the background desktop agent at random intervals (90–210 seconds).",
      feed: [
        { time: "09:42:10 AM", window: "VS Code - about/page.tsx", url: "github.com/repository", status: "screenshot.png uploaded" },
        { time: "09:44:03 AM", window: "Chrome - Firestore Rules Console", url: "console.firebase.google.com", status: "screenshot.png uploaded" }
      ]
    }
  }

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Interactive Walkthrough"
          title="Explore the live trial client"
          description="Sign in to the web dashboard to see the workspaces that ship in the trial build: people, project management, activity, and timesheets."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-16">
          {/* Workspaces Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                id: "people",
                title: "People & Org Tree",
                desc: "Configure organizational trees, and monitor live presence over Firebase RTDB.",
                color: "border-violet-100 bg-violet-50/20 text-violet-700",
                icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              },
              {
                id: "projects",
                title: "Project Boards",
                desc: "Task CRUD boards backed by Firestore collections with drag-reorder capabilities.",
                color: "border-blue-100 bg-blue-50/20 text-blue-700",
                icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              },
              {
                id: "activity",
                title: "Activity Ingestion",
                desc: "View screenshots, active foreground processes, and URL histories pushed by the desktop agent.",
                color: "border-emerald-100 bg-emerald-50/20 text-emerald-700",
                icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2"
              },
              {
                id: "timesheets",
                title: "Timesheets",
                desc: "Review logs, record manual entries, and trigger approval submissions.",
                color: "border-amber-100 bg-amber-50/20 text-amber-700",
                icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              }
            ].map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => setActiveScreen(workspace.id as any)}
                className={`text-left rounded-3xl border p-6 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between cursor-pointer bg-white ${
                  activeScreen === workspace.id ? "border-violet-300 ring-2 ring-violet-100" : "border-slate-200/80"
                }`}
              >
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${workspace.color}`}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d={workspace.icon} />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-slate-800">{workspace.title}</h3>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400 font-light">{workspace.desc}</p>
                </div>
                <div className="mt-4 text-[10px] font-bold text-violet-700 flex items-center gap-1">
                  Inspect simulator view
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <path fillRule="evenodd" d="M10.156 8L7.13 5.485A.75.75 0 018.106 4.35l3.5 2.917a.75.75 0 010 1.13l-3.5 2.917a.75.75 0 11-.976-1.136L10.156 8z" clipRule="evenodd" />
                  </svg>
                </div>
              </button>
            ))}
          </div>

          {/* Interactive Workspace Simulator Viewport */}
          <section className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8 shadow-md">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Interactive Dashboard Simulator</h3>
            <p className="text-xs text-slate-400 font-light mb-8">
              Click the cards above to simulate different interface panes inside the dashboard.
            </p>

            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col md:grid md:grid-cols-[200px_1fr] bg-slate-50 min-h-[350px]">
              {/* Sidebar Mockup */}
              <div className="bg-slate-900 text-slate-300 p-4 border-r border-slate-800 space-y-4 text-xs">
                <div className="flex items-center gap-2 px-2 py-1 bg-slate-800 rounded-lg text-white">
                  <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center font-bold text-[10px]">VT</div>
                  <span className="font-extrabold text-[11px]">Workspace Sandbox</span>
                </div>
                <div className="space-y-1">
                  {[
                    { id: "timesheets", label: "Timesheets" },
                    { id: "people", label: "People & Org" },
                    { id: "projects", label: "Projects" },
                    { id: "activity", label: "Activity Feeds" }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveScreen(tab.id as any)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        activeScreen === tab.id
                          ? "bg-violet-600/90 text-white font-bold"
                          : "hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Viewport Content Mockup */}
              <div className="bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-900">{screens[activeScreen].title}</h4>
                      <p className="text-[11px] text-slate-400 font-light mt-0.5">{screens[activeScreen].desc}</p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                      {personalized ? "Your live data" : "Live simulation"}
                    </span>
                  </div>

                  {/* Stateful Content Renders */}
                  {activeScreen === "timesheets" && (
                    <div className="space-y-2">
                      {screens.timesheets.logs.map((log, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
                          <div>
                            <div className="font-bold text-slate-800">{log.task}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{log.project}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-slate-700">{log.time}</div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border inline-block mt-1 ${
                              log.status === "Approved" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"
                            }`}>
                              {log.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeScreen === "people" && (
                    <div className="space-y-2">
                      {screens.people.members.map((member, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
                          <div>
                            <div className="font-bold text-slate-800">{member.name}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{member.role}</div>
                          </div>
                          <span className={`w-2 h-2 rounded-full ${member.active ? "bg-emerald-500 animate-ping" : "bg-slate-300"}`} />
                        </div>
                      ))}
                    </div>
                  )}

                  {activeScreen === "projects" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {screens.projects.items.map((item, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs space-y-2">
                          <div>
                            <div className="font-bold text-slate-800">{item.project}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">Client: {item.client}</div>
                          </div>
                          <div className="flex justify-between border-t border-slate-200/50 pt-2 text-[10px] text-slate-500 font-mono">
                            <span>Budget: {item.budget}</span>
                            <span>Spent: {item.spent}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeScreen === "activity" && (
                    <div className="space-y-2">
                      {screens.activity.feed.map((log, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs flex justify-between items-center">
                          <div>
                            <div className="font-bold text-slate-800">{log.window}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{log.url}</div>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-bold text-violet-600 font-mono">{log.time}</span>
                            <div className="text-[10px] text-emerald-600 mt-0.5">{log.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 pt-4 mt-6 flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-light">
                    {personalized ? "This is your real account data." : "To populate data and pair agents, launch the full trial."}
                  </span>
                  <AppCtaLink
                    href={user ? "/account/reports" : getSignInHref()}
                    className="text-violet-600 font-bold hover:text-violet-800 transition-colors"
                  >
                    {user ? "View My Activity →" : "Sign in to workspace →"}
                  </AppCtaLink>
                </div>
              </div>
            </div>
          </section>

          {/* Call to action */}
          <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-50/50 via-slate-50/30 to-blue-50/50 -z-10" />
            <h3 className="text-2xl font-extrabold text-slate-900 mb-2">{user ? "See your own activity" : "Access the Workspace"}</h3>
            <p className="text-xs md:text-sm text-slate-500 font-light max-w-lg mx-auto mb-8">
              {user
                ? "Head to My Activity for your full personal summary."
                : "No configuration required. Create an account and test role permission boundaries live."}
            </p>
            <AppCtaLink
              href={user ? "/account/reports" : getSignInHref()}
              className="inline-flex items-center rounded-full bg-violet-600 px-8 py-3.5 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer"
            >
              {user ? "View My Activity →" : "Sign In to Workspace →"}
            </AppCtaLink>
          </div>
        </div>
      </main>
    </PageShell>
  )
}
