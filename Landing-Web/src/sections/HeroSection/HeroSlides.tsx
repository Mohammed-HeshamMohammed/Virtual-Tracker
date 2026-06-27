"use client"

import { useState } from "react"

interface HeroSlidesProps {
  activeTab: number
}

export default function HeroSlides({ activeTab }: HeroSlidesProps) {
  const [slideIdx, setSlideIdx] = useState(0)

  // Number of slides per tab
  const slidesCount: Record<number, number> = {
    0: 3, // Hour logging: 3 slides
    1: 2, // Output visibility: 2 slides
    2: 2, // Workforce signals (Industries/Trust/Stats): 2 slides
    3: 1, // Pay & invoicing: 1 slide
    4: 1, // Connected apps: 1 slide
  }

  const total = slidesCount[activeTab] ?? 1

  // Handle boundary when tab changes
  const currentSlideIdx = slideIdx >= total ? 0 : slideIdx

  const renderMockup = (tab: number, slide: number) => {
    switch (tab) {
      case 0: // Hour logging
        if (slide === 0) {
          // Slide 0: Smart Timesheets (Clock-in control card)
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] text-white/50 uppercase tracking-wider font-bold">Current Session</div>
                  <div className="text-sm font-semibold text-white mt-0.5">Product Design Sprint</div>
                </div>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active
                </span>
              </div>
              <div className="text-4xl font-mono font-bold tracking-tight mb-4 text-center text-white bg-black/25 py-3 rounded-lg border border-white/5">
                04:32:18
              </div>
              <div className="flex gap-3">
                <button className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors cursor-pointer">
                  Stop Session
                </button>
                <button className="bg-white/10 hover:bg-white/15 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors cursor-pointer">
                  Switch Task
                </button>
              </div>
            </div>
          )
        } else if (slide === 1) {
          // Slide 1: Work summaries (Weekly time allocation bar chart)
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="text-sm font-semibold text-white mb-4">Weekly Time Allocation</div>
              <div className="space-y-3">
                {[
                  { day: "Mon", hours: "8h 00m", percentage: 100 },
                  { day: "Tue", hours: "7h 45m", percentage: 96 },
                  { day: "Wed", hours: "8h 15m", percentage: 100 },
                  { day: "Thu", hours: "4h 32m", percentage: 56, active: true },
                ].map(d => (
                  <div key={d.day} className="flex items-center justify-between text-xs">
                    <span className={`w-8 font-semibold ${d.active ? "text-violet-400" : "text-white/60"}`}>{d.day}</span>
                    <div className="flex-1 mx-3 bg-white/10 rounded-full h-2 overflow-hidden">
                      <div className={`h-full rounded-full ${d.active ? "bg-violet-500" : "bg-emerald-500"}`} style={{ width: `${d.percentage}%` }} />
                    </div>
                    <span className={`w-14 text-right font-mono ${d.active ? "text-violet-300 font-bold" : "text-white/80"}`}>{d.hours}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-white/50">
                <span>Total Tracked This Week:</span>
                <span className="font-mono text-white font-bold">28.5 hrs / 40.0 hrs</span>
              </div>
            </div>
          )
        } else {
          // Slide 2: Task-level logging (Checklist of tasks)
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="text-sm font-semibold text-white mb-3">Today's Tasks</div>
              <div className="space-y-2">
                {[
                  { title: "UI/UX Navigation redesign", time: "2h 15m", status: "completed" },
                  { title: "Firebase hosting redirect check", time: "1h 30m", status: "completed" },
                  { title: "Landing page mockup display", time: "0h 47m", status: "active" },
                  { title: "Type checking & config test", time: "--", status: "pending" },
                ].map(t => (
                  <div key={t.title} className="flex items-center justify-between text-xs p-2.5 rounded bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2">
                      {t.status === "completed" && (
                        <svg viewBox="0 0 16 16" className="w-4 h-4 text-emerald-400" fill="currentColor">
                          <path d="M10.97 4.97a.75.75 0 011.07 1.05l-3.99 4.99a.75.75 0 01-1.08.02L4.324 8.384a.75.75 0 111.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 01.02-.022z" />
                        </svg>
                      )}
                      {t.status === "active" && (
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                      )}
                      {t.status === "pending" && (
                        <span className="w-2 h-2 rounded-full bg-white/20" />
                      )}
                      <span className={t.status === "completed" ? "text-white/50 line-through" : "text-white/90"}>{t.title}</span>
                    </div>
                    <span className="font-mono text-white/60">{t.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        }

      case 1: // Output visibility
        if (slide === 0) {
          // Slide 0: Team visibility
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg space-y-4">
              <div className="text-sm font-semibold text-white">Active Workforce Roster</div>
              <div className="space-y-3">
                {[
                  { name: "Sarah Jenkins", role: "Product Designer", status: "Active in Figma", focus: "94%", active: true },
                  { name: "Marcus Brody", role: "Senior Backend Eng", status: "Editing routes.ts in VS Code", focus: "88%", active: true },
                  { name: "Elena Rostova", role: "QA Engineer", status: "Idle for 12 minutes", focus: "--", active: false },
                ].map(u => (
                  <div key={u.name} className="flex items-center justify-between text-xs bg-white/5 p-2.5 rounded border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center font-bold text-white text-[10px]">
                          {u.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border-2 border-indigo-950 ${u.active ? "bg-emerald-400" : "bg-amber-400"}`} />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-white">{u.name}</div>
                        <div className="text-white/60 text-[9px] mt-0.5">{u.status}</div>
                      </div>
                    </div>
                    {u.focus !== "--" && (
                      <div className="text-right">
                        <span className="text-[9px] text-white/40 uppercase block font-semibold">Focus</span>
                        <span className="font-mono font-bold text-emerald-400">{u.focus}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        } else {
          // Slide 1: Focus pattern analysis
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="text-sm font-semibold text-white mb-3">Daily App & Web Usage</div>
              <div className="space-y-3">
                {[
                  { name: "Visual Studio Code", category: "Development", percent: 62, time: "4h 25m", color: "bg-blue-500" },
                  { name: "Google Chrome", category: "Research", percent: 22, time: "1h 35m", color: "bg-emerald-500" },
                  { name: "Slack", category: "Communication", percent: 11, time: "0h 48m", color: "bg-purple-500" },
                  { name: "Spotify", category: "Entertainment", percent: 5, time: "0h 22m", color: "bg-indigo-400" },
                ].map(app => (
                  <div key={app.name} className="text-xs text-left">
                    <div className="flex items-center justify-between text-white/80 mb-1">
                      <span className="font-semibold">{app.name} <span className="text-[10px] text-white/40">({app.category})</span></span>
                      <span className="font-mono">{app.time}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full ${app.color}`} style={{ width: `${app.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }

      case 2: // Workforce signals
        if (slide === 0) {
          // Slide 0: Performance Benchmarks
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="text-sm font-semibold text-white mb-4">Department Efficiency Benchmarks</div>
              <div className="space-y-3">
                {[
                  { rank: "#1", name: "Engineering", score: "94.8", change: "+2.4%", status: "up" },
                  { rank: "#2", name: "Product Design", score: "92.1", change: "+0.8%", status: "up" },
                  { rank: "#3", name: "QA & Testing", score: "89.5", change: "-1.2%", status: "down" },
                ].map(row => (
                  <div key={row.name} className="flex items-center justify-between text-xs bg-white/5 p-2.5 rounded border border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-violet-400 w-5">{row.rank}</span>
                      <span className="font-semibold text-white">{row.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[9px] text-white/40 block">Efficiency</span>
                        <span className="font-mono font-bold text-white">{row.score}</span>
                      </div>
                      <span className={`font-mono text-[10px] font-bold ${row.status === "up" ? "text-emerald-400" : "text-red-400"}`}>
                        {row.change}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        } else {
          // Slide 1: Hybrid work analysis
          return (
            <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
              <div className="text-sm font-semibold text-white mb-4">Remote vs. In-Office Output</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-[10px] text-white/50 uppercase font-bold tracking-wider mb-1">Remote Employees</div>
                  <div className="text-3xl font-bold text-emerald-400 font-mono">92.4%</div>
                  <div className="text-[9px] text-white/40 mt-1">Avg Focus Score</div>
                  <div className="text-xs text-white/60 mt-2 font-mono">7.8 hrs logged/day</div>
                </div>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-[10px] text-white/50 uppercase font-bold tracking-wider mb-1">On-Site Employees</div>
                  <div className="text-3xl font-bold text-violet-400 font-mono">86.1%</div>
                  <div className="text-[9px] text-white/40 mt-1">Avg Focus Score</div>
                  <div className="text-xs text-white/60 mt-2 font-mono">7.2 hrs logged/day</div>
                </div>
              </div>
            </div>
          )
        }

      case 3: // Pay & invoicing
        return (
          <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <div className="text-left">
                <div className="text-[10px] text-white/50">Invoice #VT-2026-04</div>
                <div className="text-sm font-bold text-white mt-0.5">Acme Corporation</div>
              </div>
              <span className="px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold tracking-wider uppercase">
                Pending Deposit
              </span>
            </div>
            <div className="space-y-2 text-xs text-left">
              <div className="flex justify-between">
                <span className="text-white/60">Total Hours Tracked:</span>
                <span className="font-mono text-white">142.5 hrs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Hourly Rate:</span>
                <span className="font-mono text-white">$75.00/hr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Platform Service Charge:</span>
                <span className="font-mono text-white">$0.00 (Promo)</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-white/5 text-sm font-bold mt-2">
                <span className="text-white">Total Amount Due:</span>
                <span className="font-mono text-emerald-400 text-lg">$10,687.50</span>
              </div>
            </div>
          </div>
        )

      case 4: // Connected apps
        return (
          <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
            <div className="text-sm font-semibold text-white mb-4">Enterprise Sync Status</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "Jira Software", icon: "Ji", color: "bg-blue-600" },
                { name: "Slack Workspace", icon: "Sl", color: "bg-yellow-600" },
                { name: "Deel Payroll", icon: "De", color: "bg-emerald-600" },
                { name: "GitHub Repos", icon: "Gi", color: "bg-slate-800" },
              ].map(app => (
                <div key={app.name} className="flex items-center justify-between p-2.5 bg-white/5 rounded border border-white/5 text-xs text-left">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-white font-extrabold text-[9px] ${app.color}`}>
                      {app.icon}
                    </div>
                    <span className="font-medium text-white">{app.name.split(" ")[0]}</span>
                  </div>
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-bold">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" /> Connected
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="relative mx-auto max-w-4xl select-none">
      {total > 1 && (
        <button
          onClick={() => setSlideIdx(i => (i - 1 + total) % total)}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 z-10 w-10 h-10 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/20 transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50 bg-[#151030]/90 backdrop-blur-md p-6 h-[380px] flex flex-col justify-between">
        {/* macOS Window Title Bar */}
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="text-[10px] text-white/40 ml-2 font-mono">virtual-tracker-v0.12.app</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/30 font-semibold font-mono">
            TAB_{activeTab} / SLIDE_{currentSlideIdx}
          </div>
        </div>

        {/* Inner Dashboard Mockup Box */}
        <div className="flex-1 flex flex-col justify-center items-center py-4">
          {renderMockup(activeTab, currentSlideIdx)}
        </div>
      </div>

      {total > 1 && (
        <button
          onClick={() => setSlideIdx(i => (i + 1) % total)}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 z-10 w-10 h-10 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/20 transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      )}

      {total > 1 && (
        <div className="flex justify-center gap-1.5 mt-4 pb-2">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSlideIdx(i)}
              className={`rounded-full transition-all duration-200 cursor-pointer ${
                i === currentSlideIdx ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
