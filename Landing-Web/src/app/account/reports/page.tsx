"use client"

import { useEffect, useState } from "react"
import { fetchMyActivitySummary, type MyActivitySummary } from "@/lib/api/dashboard-general"

export default function ReportsPage() {
  const [summary, setSummary] = useState<MyActivitySummary | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void fetchMyActivitySummary().then((result) => {
      if (!cancelled) setSummary(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (summary === undefined) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      </div>
    )
  }

  const hasData =
    summary && (summary.recentProjects.length > 0 || summary.todos.length > 0 || summary.stats.workedWeekHours > 0)

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 mb-1">My Activity</h1>
        <p className="text-xs text-slate-500 mb-6">Your own tracked time and activity, pulled live from Dashboard-Backend.</p>

        {!summary || !hasData ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">Nothing to show yet</p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              {summary
                ? "You're not assigned to a team or project yet, so there's no activity to summarize. An admin needs to add you to a workspace first."
                : "We couldn't load your activity right now. Try refreshing the page."}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Worked today</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{summary.stats.workedTodayHours}h</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Worked this week</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{summary.stats.workedWeekHours}h</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Activity today</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{summary.stats.activityTodayPercent}%</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Activity this week</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{summary.stats.activityWeekPercent}%</p>
            </div>
          </div>
        )}
      </div>

      {summary && summary.recentProjects.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Recent projects</h2>
          <ul className="space-y-3">
            {summary.recentProjects.map((project) => (
              <li key={project.id} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{project.name}</span>
                <span className="text-slate-400">{project.progress}% complete</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && summary.todos.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Open tasks</h2>
          <ul className="space-y-3">
            {summary.todos.map((task) => (
              <li key={task.id} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{task.title}</span>
                <span className="text-slate-400">{task.projectName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
