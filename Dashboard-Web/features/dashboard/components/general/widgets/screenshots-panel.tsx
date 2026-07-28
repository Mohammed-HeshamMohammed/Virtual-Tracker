"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion } from "framer-motion"
import { ExternalLink, Maximize2, Monitor, X } from "lucide-react"
import { getScreenshotActivityColor, type Screenshot } from "@/features/activity/components/utils"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { useDashboardScreenshots } from "@/features/dashboard/components/general/hooks/use-dashboard-screenshots"
import { cn } from "@/shared/utils/utils"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"

const ACTIVITY_SCREENSHOTS_ROUTE = "activity-screenshots"
const PREVIEW_COUNT = 6

function pickPreviews(rows: Screenshot[]): Screenshot[] {
  const sorted = [...rows].sort((a, b) => {
    const aMs = a.capturedAt ? Date.parse(a.capturedAt) : 0
    const bMs = b.capturedAt ? Date.parse(b.capturedAt) : 0
    return bMs - aMs
  })
  const seen = new Set<string>()
  const out: Screenshot[] = []
  for (const s of sorted) {
    if (seen.has(s.member)) continue
    seen.add(s.member)
    out.push(s)
    if (out.length >= PREVIEW_COUNT) break
  }
  return out.length > 0 ? out : sorted.slice(0, PREVIEW_COUNT)
}

export function ScreenshotsPanel({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { view } = useGeneralDashboard()
  const { data, loading, error } = useDashboardScreenshots(view)
  const previews = useMemo(() => pickPreviews(data ?? []), [data])
  const [selected, setSelected] = useState<Screenshot | null>(null)

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  return (
    <>
      <PanelShell
        title="Screenshots"
        subtitle="Latest team captures"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        }
        iconClassName="bg-pink-500"
        loading={loading}
        error={error}
        empty={!loading && previews.length === 0}
        emptyMessage="No captures yet. Start the agent and timer to collect screenshots."
        action={
          <button
            type="button"
            onClick={() => onNavigate?.(ACTIVITY_SCREENSHOTS_ROUTE)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            View all <ExternalLink className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {previews.map((shot, index) => (
            <motion.button
              key={shot.id}
              type="button"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.04 }}
              onClick={() => setSelected(shot)}
              className="group overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <div className="relative aspect-video bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700">
                {shot.imageData ? (
                  <Image
                    src={shot.imageData}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-top"
                    width={320}
                    height={180}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Monitor className="h-8 w-8 text-slate-300 dark:text-slate-700" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <Maximize2 className="h-5 w-5 text-white" />
                </div>
                <span
                  className={cn(
                    "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white",
                    getScreenshotActivityColor(shot.activityLevel),
                  )}
                >
                  {shot.activityLevel}%
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{shot.member}</p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{shot.time}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </PanelShell>

      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            role="presentation"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="screenshot-preview-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 p-4">
                <div>
                  <p id="screenshot-preview-title" className="font-bold text-slate-900 dark:text-slate-100">
                    {selected.member}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {selected.timestamp} · {selected.time}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>
              <div className="flex aspect-video items-center justify-center bg-slate-100 dark:bg-slate-800">
                {selected.imageData ? (
                  <Image src={selected.imageData} alt="" className="h-full w-full object-contain" width={800} height={450} />
                ) : (
                  <Monitor className="h-16 w-16 text-slate-300 dark:text-slate-700" />
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
