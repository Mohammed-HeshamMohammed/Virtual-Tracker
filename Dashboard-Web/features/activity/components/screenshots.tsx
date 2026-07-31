//components/activity/screenshots.tsx
"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useActivityFeed } from "@/features/activity/hooks/use-activity-feed"
import {
  getCachedScreenshotImage,
  loadScreenshotImage,
} from "@/features/activity/utils/screenshot-image-cache"
import { ActivityEmptyState } from "@/features/activity/components/activity-empty-state"
import {
  ActivityDayEmptyState,
  ActivityLoadingState,
  ActivitySearchEmptyState,
} from "@/features/activity/components/activity-page-states"
import { ActivitySection } from "@/features/activity/components/activity-section"
import { usePaginatedTable } from "@/shared/tables/hooks/use-paginated-table"
import { TablePagination } from "@/shared/tables/ui"

const SCREENSHOTS_PER_PAGE = 8
import { formatActivityAppName } from "@/features/activity/utils/display-names"
import { useActivityShell, useActivityShellRegistration } from "@/features/activity/components/activity-shell-context"
import { useAuth } from "@/shared/providers/app"
import { canManageActivityData } from "@/features/auth"
import { motion, AnimatePresence } from "framer-motion"
import {
  Download,
  Monitor,
  Maximize2,
  X,
  Clock,
  User,
  Trash2,
  BarChart2,
  Focus,
  AlertTriangle,
  Target,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"

export interface Screenshot {
  id: string
  member: string
  avatar: string
  project: string
  capturedAt?: string
  timestamp: string
  time: string
  activityLevel: number
  activeApp: string
  imageData?: string
  hasImage?: boolean
  pageTitle?: string
  memberId?: string
}

const CORE_APPS = ["VS Code", "IntelliJ IDEA", "Xcode", "Terminal", "Postman"]
const PRODUCTIVE_APPS = ["Figma", "Adobe XD", "Chrome DevTools"]
const SUSPICIOUS_APPS = ["Chrome", "Firefox", "Safari", "YouTube", "Netflix"]
const FOCUS_THRESHOLD = 75
const HIGH_ACTIVITY_THRESHOLD = 90
const LOW_ACTIVITY_THRESHOLD = 50

/** @deprecated Use API feed; kept empty so dashboard widget does not show demo rows */
export const activityScreenshotsData: Screenshot[] = []

export const getScreenshotActivityColor = (level: number) => {
  if (level >= 80) return "bg-emerald-500"
  if (level >= 60) return "bg-amber-500"
  return "bg-red-500"
}

const getActivityTextColor = (level: number) => {
  if (level >= 80) return "text-emerald-600 dark:text-emerald-400"
  if (level >= 60) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function TopPersonRow({ avatar, name, value, accent }: { avatar: string; name: string; value: string; accent?: "green" | "amber" | "red" }) {
  const accents = { green: "text-emerald-600 dark:text-emerald-400", amber: "text-amber-600 dark:text-amber-400", red: "text-red-500 dark:text-red-400" }
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
        {avatar}
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">{name}</span>
      <span className={cn("text-xs font-semibold shrink-0", accent ? accents[accent] : "text-slate-700 dark:text-slate-200")}>{value}</span>
    </div>
  )
}

function WorkTimeSection({ data }: { data: Screenshot[] }) {
  const { totals, topCore, topUnproductive } = useMemo(() => {
    const map: Record<string, { avatar: string; core: number; nonCore: number; unproductive: number; total: number }> = {}
    data.forEach((s) => {
      if (!map[s.member]) map[s.member] = { avatar: s.avatar, core: 0, nonCore: 0, unproductive: 0, total: 0 }
      const e = map[s.member]
      e.total++
      if (CORE_APPS.includes(s.activeApp)) e.core++
      else if (PRODUCTIVE_APPS.includes(s.activeApp)) e.nonCore++
      else e.unproductive++
    })
    let core = 0, nonCore = 0, unproductive = 0
    Object.values(map).forEach((m) => { core += m.core; nonCore += m.nonCore; unproductive += m.unproductive })
    const total = core + nonCore + unproductive || 1
    const sorted = Object.entries(map)
    return {
      totals: { core: Math.round((core / total) * 100), nonCore: Math.round((nonCore / total) * 100), unproductive: Math.round((unproductive / total) * 100) },
      topCore: sorted.sort((a, b) => b[1].core / (b[1].total || 1) - a[1].core / (a[1].total || 1))[0],
      topUnproductive: sorted.sort((a, b) => b[1].unproductive / (b[1].total || 1) - a[1].unproductive / (a[1].total || 1))[0],
    }
  }, [data])

  return (
    <div className="space-y-2.5">
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
        <div className="bg-emerald-400 transition-all" style={{ width: `${totals.core}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${totals.nonCore}%` }} />
        <div className="bg-red-400 transition-all flex-1" />
      </div>
      <div className="flex gap-3 flex-wrap">
        {[
          { label: "Core", value: totals.core, color: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-400" },
          { label: "Non-core", value: totals.nonCore, color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-400" },
          { label: "Unprod.", value: totals.unproductive, color: "text-red-500 dark:text-red-400", dot: "bg-red-400" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <div className={cn("w-1.5 h-1.5 rounded-full", item.dot)} />
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.label}</span>
            <span className={cn("text-[10px] font-semibold", item.color)}>{item.value}%</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-0.5">
        {topCore && (
          <TopPersonRow
            avatar={topCore[1].avatar}
            name={topCore[0].split(" ")[0]}
            value={`${Math.round((topCore[1].core / topCore[1].total) * 100)}% core`}
            accent="green"
          />
        )}
        {topUnproductive && topUnproductive[1].unproductive > 0 && (
          <TopPersonRow
            avatar={topUnproductive[1].avatar}
            name={topUnproductive[0].split(" ")[0]}
            value={`${Math.round((topUnproductive[1].unproductive / topUnproductive[1].total) * 100)}% unprod.`}
            accent="red"
          />
        )}
      </div>
    </div>
  )
}

function FocusTimeSection({ data }: { data: Screenshot[] }) {
  const { teamFocus, mostFocused, mostDistracted } = useMemo(() => {
    const map: Record<string, { avatar: string; focused: number; distracted: number; total: number }> = {}
    data.forEach((s) => {
      if (!map[s.member]) map[s.member] = { avatar: s.avatar, focused: 0, distracted: 0, total: 0 }
      map[s.member].total++
      if (s.activityLevel >= FOCUS_THRESHOLD) map[s.member].focused++
      else map[s.member].distracted++
    })
    const all = Object.values(map)
    const total = all.reduce((a, m) => a + m.total, 0) || 1
    const focused = all.reduce((a, m) => a + m.focused, 0)
    const entries = Object.entries(map)
    return {
      teamFocus: Math.round((focused / total) * 100),
      mostFocused: [...entries].sort((a, b) => b[1].focused / (b[1].total || 1) - a[1].focused / (a[1].total || 1))[0],
      mostDistracted: [...entries].sort((a, b) => b[1].distracted / (b[1].total || 1) - a[1].distracted / (a[1].total || 1))[0],
    }
  }, [data])

  return (
    <div className="space-y-2.5">
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{teamFocus}%</span>
        <span className="text-xs text-slate-400 dark:text-slate-500 mb-1">team focus rate</span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${teamFocus}%` }} />
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-0.5">
        {mostFocused && (
          <TopPersonRow
            avatar={mostFocused[1].avatar}
            name={mostFocused[0].split(" ")[0]}
            value={`${Math.round((mostFocused[1].focused / mostFocused[1].total) * 100)}% focused`}
            accent="green"
          />
        )}
        {mostDistracted && (
          <TopPersonRow
            avatar={mostDistracted[1].avatar}
            name={mostDistracted[0].split(" ")[0]}
            value={`${Math.round((mostDistracted[1].distracted / mostDistracted[1].total) * 100)}% distracted`}
            accent="amber"
          />
        )}
      </div>
    </div>
  )
}

function UnusualActivitySection({ data }: { data: Screenshot[] }) {
  const flags = useMemo(() => {
    const suspicious: { avatar: string; name: string; app: string }[] = []
    const highActivity: { avatar: string; name: string; level: number }[] = []
    const lowInput: { avatar: string; name: string; level: number }[] = []
    data.forEach((s) => {
      if (SUSPICIOUS_APPS.some((a) => s.activeApp.toLowerCase().includes(a.toLowerCase()))) {
        suspicious.push({ avatar: s.avatar, name: s.member.split(" ")[0], app: s.activeApp })
      }
      if (s.activityLevel >= HIGH_ACTIVITY_THRESHOLD) {
        highActivity.push({ avatar: s.avatar, name: s.member.split(" ")[0], level: s.activityLevel })
      }
      if (s.activityLevel < LOW_ACTIVITY_THRESHOLD) {
        lowInput.push({ avatar: s.avatar, name: s.member.split(" ")[0], level: s.activityLevel })
      }
    })
    return {
      suspicious,
      highActivity: highActivity.sort((a, b) => b.level - a.level),
      lowInput: lowInput.sort((a, b) => a.level - b.level),
    }
  }, [data])

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "Suspicious", count: flags.suspicious.length, color: "text-red-500 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/60" },
          { label: "High activity", count: flags.highActivity.length, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/60" },
          { label: "Low input", count: flags.lowInput.length, color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-800/60" },
        ].map((item) => (
          <div key={item.label} className={cn("rounded-lg p-2 text-center", item.bg)}>
            <div className={cn("text-base font-bold leading-tight", item.color)}>{item.count}</div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-0.5">
        {flags.highActivity[0] && (
          <TopPersonRow
            avatar={flags.highActivity[0].avatar}
            name={flags.highActivity[0].name}
            value={`${flags.highActivity[0].level}% activity`}
            accent="amber"
          />
        )}
        {flags.suspicious[0] && (
          <TopPersonRow
            avatar={flags.suspicious[0].avatar}
            name={flags.suspicious[0].name}
            value={flags.suspicious[0].app}
            accent="red"
          />
        )}
        {flags.suspicious.length === 0 && flags.highActivity.length === 0 && flags.lowInput.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 py-1">No unusual instances detected</p>
        )}
      </div>
    </div>
  )
}

function BenchmarksSection({ data }: { data: Screenshot[] }) {
  const { teamAvgActivity, topWorked, topActivity, memberCount } = useMemo(() => {
    const map: Record<string, { avatar: string; count: number; totalActivity: number }> = {}
    data.forEach((s) => {
      if (!map[s.member]) map[s.member] = { avatar: s.avatar, count: 0, totalActivity: 0 }
      map[s.member].count++
      map[s.member].totalActivity += s.activityLevel
    })
    const members = Object.entries(map).map(([name, m]) => ({
      name,
      avatar: m.avatar,
      count: m.count,
      avgActivity: Math.round(m.totalActivity / m.count),
    }))
    return {
      memberCount: members.length,
      teamAvgActivity: Math.round(data.reduce((a, s) => a + s.activityLevel, 0) / (data.length || 1)),
      topWorked: [...members].sort((a, b) => b.count - a.count)[0],
      topActivity: [...members].sort((a, b) => b.avgActivity - a.avgActivity)[0],
    }
  }, [data])

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-base font-bold text-slate-700 dark:text-slate-200 leading-tight">{memberCount}</div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">active members</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2 text-center">
          <div className={cn("text-base font-bold leading-tight", getActivityTextColor(teamAvgActivity))}>{teamAvgActivity}%</div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">avg. activity</div>
        </div>
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-0.5">
        {topWorked && (
          <TopPersonRow
            avatar={topWorked.avatar}
            name={topWorked.name.split(" ")[0]}
            value={`${topWorked.count} captures`}
            accent="green"
          />
        )}
        {topActivity && (
          <TopPersonRow
            avatar={topActivity.avatar}
            name={topActivity.name.split(" ")[0]}
            value={`${topActivity.avgActivity}% avg`}
            accent="green"
          />
        )}
      </div>
    </div>
  )
}

function ScreenshotThumbnail({
  screenshot,
  className,
}: {
  screenshot: Screenshot
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(
    () => screenshot.imageData ?? getCachedScreenshotImage(screenshot.id) ?? null,
  )
  const [loading, setLoading] = useState(false)
  const mayHaveImage = screenshot.hasImage !== false

  useEffect(() => {
    if (src || !mayHaveImage) return
    let cancelled = false
    setLoading(true)
    void loadScreenshotImage(screenshot.id).then((url) => {
      if (cancelled) return
      if (url) setSrc(url)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [mayHaveImage, screenshot.id, src])

  return (
    <div className={cn("relative aspect-video w-full bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700", className)}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
      ) : loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-slate-500 dark:border-t-slate-400" />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Monitor className="w-10 h-10 text-slate-300 dark:text-slate-700" />
        </div>
      )}
    </div>
  )
}

const insightCards = [
  { id: "work-time", icon: <BarChart2 className="w-4 h-4" />, title: "WORK TIME CLASSIFICATION", Component: WorkTimeSection },
  { id: "focus-time", icon: <Focus className="w-4 h-4" />, title: "FOCUS TIME", Component: FocusTimeSection },
  { id: "unusual-activity", icon: <AlertTriangle className="w-4 h-4" />, title: "UNUSUAL ACTIVITY INSTANCES", Component: UnusualActivitySection },
  { id: "activity-benchmarks", icon: <Target className="w-4 h-4" />, title: "ACTIVITY BENCHMARKS", Component: BenchmarksSection },
]

export function ActivityScreenshots() {
  const { memberRole } = useAuth()
  const canManage = canManageActivityData(memberRole)
  const {
    day,
    searchQuery,
    viewMode,
    sortOrder,
  } = useActivityShell()
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null)
  const { data: liveRows, loading, error, disabledReason, reload } = useActivityFeed<Screenshot[]>("screenshots", {
    day: day.dayKey,
  })
  const [modalImageData, setModalImageData] = useState<string | null>(null)
  const [modalImageLoading, setModalImageLoading] = useState(false)

  useActivityShellRegistration({
    onRefresh: () => {
      void reload({ force: true })
    },
  })

  useEffect(() => {
    if (!selectedScreenshot) {
      setModalImageData(null)
      setModalImageLoading(false)
      return
    }
    const cached =
      selectedScreenshot.imageData ?? getCachedScreenshotImage(selectedScreenshot.id) ?? null
    if (cached) {
      setModalImageData(cached)
      setModalImageLoading(false)
      return
    }
    if (selectedScreenshot.hasImage === false) {
      setModalImageData(null)
      setModalImageLoading(false)
      return
    }
    let cancelled = false
    setModalImageLoading(true)
    setModalImageData(null)
    void loadScreenshotImage(selectedScreenshot.id).then((url) => {
      if (cancelled) return
      setModalImageData(url)
      setModalImageLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedScreenshot])

  const allScreenshots = liveRows ?? []

  const searchLower = searchQuery.trim().toLowerCase()
  const displayScreenshots = useMemo(() => {
    const searched = searchLower
      ? allScreenshots.filter(
          (s) =>
            s.project.toLowerCase().includes(searchLower) ||
            s.activeApp.toLowerCase().includes(searchLower) ||
            s.member.toLowerCase().includes(searchLower) ||
            (s.pageTitle?.toLowerCase().includes(searchLower) ?? false),
        )
      : allScreenshots
    const getCaptureTime = (s: Screenshot) => {
      const raw = s.capturedAt ?? s.timestamp
      const ms = raw ? Date.parse(raw) : NaN
      return Number.isFinite(ms) ? ms : 0
    }
    return [...searched].sort((a, b) => {
      const diff = getCaptureTime(b) - getCaptureTime(a)
      return sortOrder === "oldest" ? -diff : diff
    })
  }, [allScreenshots, searchLower, sortOrder])

  const { currentPage, setCurrentPage, totalPages, visibleRows, rowsPerPage } =
    usePaginatedTable(displayScreenshots, SCREENSHOTS_PER_PAGE)

  // Arrow-key navigation walks the full filtered/sorted list, not just the
  // current page, so paging doesn't interrupt stepping through screenshots.
  const selectedIndex = selectedScreenshot
    ? displayScreenshots.findIndex((s) => s.id === selectedScreenshot.id)
    : -1

  const navigateScreenshot = useCallback(
    (direction: 1 | -1) => {
      if (selectedIndex === -1) return
      const nextIndex = selectedIndex + direction
      if (nextIndex < 0 || nextIndex >= displayScreenshots.length) return
      setSelectedScreenshot(displayScreenshots[nextIndex])
    },
    [selectedIndex, displayScreenshots],
  )

  useEffect(() => {
    if (!selectedScreenshot) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        navigateScreenshot(-1)
      } else if (event.key === "ArrowRight") {
        navigateScreenshot(1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedScreenshot, navigateScreenshot])

  const hasDayData = allScreenshots.length > 0
  const isAllDays = day.dayMode === "all"
  const showCaptureBanner = !loading && !!disabledReason && hasDayData
  const showDayEmpty = !loading && !hasDayData && !isAllDays
  const showNoHistoryEmpty = !loading && !hasDayData && isAllDays && !!disabledReason
  const showAllDaysEmpty = !loading && !hasDayData && isAllDays && !disabledReason
  const showSearchEmpty = !loading && hasDayData && displayScreenshots.length === 0
  const showInsights = !loading && hasDayData

  return (
    <>
      {loading ? <ActivityLoadingState label="Loading screenshots…" /> : null}

      {!loading && error ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      {showCaptureBanner ? (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
          {disabledReason}
        </div>
      ) : null}

      {showNoHistoryEmpty ? (
        <ActivityEmptyState
          title="Screenshot capture is off"
          description={disabledReason ?? "No screenshots are available yet."}
        />
      ) : null}

      {showDayEmpty ? (
        <ActivityDayEmptyState icon={Monitor} title="No screenshots for this day" />
      ) : null}

      {showAllDaysEmpty ? (
        <ActivityDayEmptyState icon={Monitor} title="No screenshots yet" />
      ) : null}

      {!loading && showSearchEmpty ? (
        <ActivitySearchEmptyState entityLabel="screenshots" />
      ) : null}

      {!loading && displayScreenshots.length > 0 && viewMode === "grid" ? (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
          {visibleRows.map((screenshot, index) => (
            <motion.div
              key={screenshot.id}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.03 + index * 0.03 }}
              whileHover={{ y: -4 }}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden group cursor-pointer"
              onClick={() => setSelectedScreenshot(screenshot)}
            >
              <div className="relative w-full">
                <ScreenshotThumbnail screenshot={screenshot} />
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 className="h-8 w-8 text-white" />
                  </div>
                  <div className="absolute top-2 right-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-1 text-xs font-bold text-white",
                        getScreenshotActivityColor(screenshot.activityLevel),
                      )}
                    >
                      {screenshot.activityLevel}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-linear-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-200">
                    {screenshot.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{screenshot.member}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{screenshot.time}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                    Task: {screenshot.project}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {formatActivityAppName(screenshot.activeApp)}
                  </span>
                </div>
                {screenshot.pageTitle ? (
                  <p className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500" title={screenshot.pageTitle}>
                    {screenshot.pageTitle}
                  </p>
                ) : null}
              </div>
            </motion.div>
          ))}
          </motion.div>
          {displayScreenshots.length > 0 ? (
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={displayScreenshots.length}
              rowsPerPage={rowsPerPage}
              onPageChange={setCurrentPage}
            />
          ) : null}
        </div>
      ) : !loading && displayScreenshots.length > 0 ? (
        <div className="space-y-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
                {["Member", "Time", "Task", "App", "Activity"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-5 py-3">{h}</th>
                ))}
                {canManage ? (
                  <th className="text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-5 py-3">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleRows.map((screenshot) => (
                <tr
                  key={screenshot.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  onClick={() => setSelectedScreenshot(screenshot)}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-linear-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-200">
                        {screenshot.avatar}
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{screenshot.member}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4"><span className="text-sm text-slate-600 dark:text-slate-300">{screenshot.time}</span></td>
                  <td className="px-5 py-4"><span className="text-sm text-slate-600 dark:text-slate-300">{screenshot.project}</span></td>
                  <td className="px-5 py-4"><span className="text-sm text-slate-600 dark:text-slate-300">{screenshot.activeApp}</span></td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", getScreenshotActivityColor(screenshot.activityLevel))} style={{ width: `${screenshot.activityLevel}%` }} />
                      </div>
                      <span className={cn("text-sm font-medium", getActivityTextColor(screenshot.activityLevel))}>{screenshot.activityLevel}%</span>
                    </div>
                  </td>
                  {canManage ? (
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedScreenshot(screenshot) }} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                          <Maximize2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        </button>
                        <button type="button" onClick={(e) => e.stopPropagation()} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        {displayScreenshots.length > 0 ? (
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={displayScreenshots.length}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
          />
        ) : null}
        </div>
      ) : null}

      {showInsights ? (
        <ActivitySection title="Daily insights" description="Aggregated from today's captures">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
        >
          {insightCards.map(({ id, icon, title, Component }, i) => (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.05 }}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-4 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-400 dark:text-slate-500">{icon}</span>
                <span className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 dark:text-slate-500">{title}</span>
              </div>
              <Component data={displayScreenshots} />
            </motion.div>
          ))}
        </motion.div>
        </ActivitySection>
      ) : null}

      {/* Screenshot Modal */}
      <AnimatePresence>
        {selectedScreenshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedScreenshot(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-xl max-w-4xl w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-linear-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center font-semibold text-slate-600 dark:text-slate-200">
                    {selectedScreenshot.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{selectedScreenshot.member}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{selectedScreenshot.timestamp} at {selectedScreenshot.time}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedScreenshot(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                  <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>
              <div className="relative aspect-video bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700">
                {modalImageLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                    Loading image…
                  </div>
                ) : modalImageData ? (
                  <img
                    src={modalImageData}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain bg-slate-900"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Monitor className="w-24 h-24 text-slate-300 dark:text-slate-700" />
                  </div>
                )}
                {selectedIndex > 0 ? (
                  <button
                    type="button"
                    onClick={() => navigateScreenshot(-1)}
                    aria-label="Previous screenshot"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                ) : null}
                {selectedIndex !== -1 && selectedIndex < displayScreenshots.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => navigateScreenshot(1)}
                    aria-label="Next screenshot"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                ) : null}
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">Activity: {selectedScreenshot.activityLevel}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">{selectedScreenshot.activeApp}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">{selectedScreenshot.project}</span>
                  </div>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                    <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

