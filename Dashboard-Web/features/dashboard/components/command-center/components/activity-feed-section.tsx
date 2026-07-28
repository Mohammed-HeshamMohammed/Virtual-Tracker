"use client"

import { MoreHorizontal } from "lucide-react"
import type { ActivityFeedItem } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

interface ActivityFeedSectionProps {
  feed: ActivityFeedItem[]
  onNavigate?: (id: string, state?: Record<string, unknown>) => void
}

export function ActivityFeedSection({ feed, onNavigate }: ActivityFeedSectionProps) {
  return (
    <SectionCard className="lg:col-span-2">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Recent Activity Feed</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Across all projects you can access</p>
        </div>
        <button
          onClick={() => onNavigate?.("activity-screenshots")}
          className="text-green-700 dark:text-green-400 text-xs font-bold hover:underline uppercase tracking-wide"
          type="button"
        >
          View All Feed
        </button>
      </div>
      <div className="space-y-6">
        {feed.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No recent activity yet.</p>
        ) : (
          feed.map((item, i) => (
            <div key={`${item.person}-${item.time}-${item.type}-${i}`}>
              {i > 0 && <div className="h-px bg-slate-50 dark:bg-slate-800 mb-6" />}
              <div className="flex gap-6 items-start group">
                <div className="flex-shrink-0 relative">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl">{item.avatar}</div>
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 ${item.type === "screenshot" ? "bg-green-700" : "bg-indigo-600"} border-2 border-white dark:border-slate-900 rounded-full flex items-center justify-center`}>
                    <span className="text-white text-[8px] font-bold">{item.type === "screenshot" ? "📷" : "✓"}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {item.person}{" "}
                        <span className="text-slate-500 dark:text-slate-400 font-normal">{item.action}</span>
                        {item.task && <span className="text-slate-900 dark:text-slate-100 font-semibold"> {item.task}</span>}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Project: {item.project} · {item.time}</p>
                    </div>
                    {item.activityBadge ? (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1 rounded-md self-start shrink-0">{item.activityBadge}</span>
                    ) : (
                      <button className="text-slate-400 dark:text-slate-500 hover:text-green-700 dark:hover:text-green-400 transition-colors shrink-0" type="button"><MoreHorizontal className="w-5 h-5" /></button>
                    )}
                  </div>
                  {item.type === "screenshot" && (
                    <div className="mt-3 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-video w-64 border border-slate-200 dark:border-slate-700 group-hover:border-green-700/20 dark:group-hover:border-green-500/30 transition-colors flex items-center justify-center">
                      <div className="text-center text-slate-300 dark:text-slate-600 space-y-1">
                        <div className="text-3xl">🖥</div>
                        <p className="text-[10px] font-medium">Screenshot preview</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  )
}
