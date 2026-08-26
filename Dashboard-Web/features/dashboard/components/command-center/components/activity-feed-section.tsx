"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Monitor, MoreHorizontal } from "lucide-react"
import { fetchActivityScreenshotImage } from "@/features/activity/services/activity-api"
import type { ActivityFeedItem } from "@/features/dashboard/components/command-center/constants"
import { SectionCard } from "@/features/dashboard/components/command-center/components/section-card"

/** The two latest captures, shown side by side above the rest of the feed. */
function ScreenshotCard({ item }: { item: ActivityFeedItem }) {
  const [image, setImage] = useState<string | null>(null)
  const screenshotId = item.screenshotId

  useEffect(() => {
    if (!screenshotId) return
    let cancelled = false
    void fetchActivityScreenshotImage(screenshotId).then((data) => {
      if (!cancelled) setImage(data)
    })
    return () => {
      cancelled = true
    }
  }, [screenshotId])

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="relative aspect-video bg-slate-100 dark:bg-slate-800">
        {image ? (
          <Image src={image} alt="" width={480} height={270} className="absolute inset-0 h-full w-full object-cover object-top" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Monitor className="h-8 w-8 text-slate-300 dark:text-slate-700" />
          </div>
        )}
        {item.activityBadge ? (
          <span className="absolute right-2 top-2 rounded-md bg-emerald-600/90 px-2 py-0.5 text-[10px] font-bold text-white">
            {item.activityBadge}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{item.person}</p>
        <p className="truncate text-xs text-slate-400 dark:text-slate-500">
          {item.project} · {item.time}
        </p>
      </div>
    </div>
  )
}

interface ActivityFeedSectionProps {
  feed: ActivityFeedItem[]
  onNavigate?: (id: string, state?: Record<string, unknown>) => void
}

export function ActivityFeedSection({ feed, onNavigate }: ActivityFeedSectionProps) {
  // The two latest captures go in the grid above; everything else keeps the
  // stacked timeline, which no longer renders its own placeholder tile.
  const shots = feed.filter((item) => item.type === "screenshot").slice(0, 2)
  const rest = feed.filter((item) => !shots.includes(item))

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
      {shots.length > 0 && (
        <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {shots.map((shot, i) => (
            <ScreenshotCard key={shot.screenshotId ?? `${shot.person}-${i}`} item={shot} />
          ))}
        </div>
      )}
      <div className="space-y-6">
        {feed.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No recent activity yet.</p>
        ) : (
          rest.map((item, i) => (
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
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  )
}
