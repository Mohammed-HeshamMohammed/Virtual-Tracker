/* eslint-disable react-doctor/no-initialize-state, react-doctor/no-derived-state */
"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE, GROUP_BY_OPTIONS, TABLE_METRIC_COLUMNS } from "@/features/reports/components/shared/constants"
import { attachForwardWheelToDocument } from "@/features/reports/utils/time-and-activity"
import {
  buildDisplayDay,
  columnVisibleInTable,
  comparePeriodRows,
  getFilteredSubRows,
  getMemberFilterOptions,
  getProjectFilterOptions,
  type TrackedTimeFilter,
} from "@/features/reports/utils/time-and-activity"
import type { TimeActivityGroupBy, TimeActivityMetric, TimeActivityReportData } from "@/features/reports/models/time-and-activity"
import { getMembers } from "@/features/members/api/member-api"

const DEFAULT_PERIOD_COLS = [
  "client",
  "team",
  "todo",
  "project",
  "total_hours",
  "activity_pct",
  "idle_pct",
  "idle_hr",
  "total_spent",
] as const

const SAVED_VIEW_KEY = "reports:time-and-activity:view"

type SavedView = {
  groupBy: TimeActivityGroupBy
  memberFilter: string
  enabledPeriodCols: string[]
  enabledMemberCols: string[]
  projectFilter?: string
  trackedTimeFilter?: TrackedTimeFilter
}

function loadSavedView(): SavedView | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(SAVED_VIEW_KEY)
    return raw ? (JSON.parse(raw) as SavedView) : null
  } catch {
    return null
  }
}

export type UseTimeAndActivityReportParams = TimeActivityReportData

export function useTimeAndActivityReport({ days, memberRows }: UseTimeAndActivityReportParams) {
  const savedView = useMemo(() => loadSavedView(), [])
  const [chartMetrics, setChartMetrics] = useState<Set<TimeActivityMetric>>(
    () => new Set<TimeActivityMetric>(["total_hours"])
  )

  function toggleChartMetric(m: TimeActivityMetric) {
    setChartMetrics((prev) => {
      const s = new Set(prev)
      if (s.has(m)) {
        if (s.size <= 1) return s
        s.delete(m)
      } else {
        s.add(m)
      }
      return s
    })
  }

  const [groupBy, setGroupBy] = useState<TimeActivityGroupBy>(savedView?.groupBy ?? "date_per_day")
  const [memberFilter, setMemberFilter] = useState<string>(savedView?.memberFilter ?? ALL_MEMBERS_VALUE)
  const [projectFilter, setProjectFilter] = useState<string>(savedView?.projectFilter ?? ALL_PROJECTS_VALUE)
  const [trackedTimeFilter, setTrackedTimeFilter] = useState<TrackedTimeFilter>(
    savedView?.trackedTimeFilter ?? "all"
  )
  const [justSaved, setJustSaved] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [filterPortalMounted, setFilterPortalMounted] = useState(false)
  const reportColumnRef = useRef<HTMLDivElement>(null)
  const filterScrimRef = useRef<HTMLDivElement | null>(null)
  const [filterPanelLayout, setFilterPanelLayout] = useState<CSSProperties | null>(null)

  useEffect(() => {
    setFilterPortalMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!showFilters) return
    let detach: (() => void) | undefined
    let rafId = 0
    function tryAttach(): boolean {
      const el = filterScrimRef.current
      if (!el) return false
      detach = attachForwardWheelToDocument(el)
      return true
    }
    if (!tryAttach()) {
      rafId = requestAnimationFrame(() => {
        tryAttach()
      })
    }
    return () => {
      cancelAnimationFrame(rafId)
      detach?.()
    }
  }, [showFilters])

  useLayoutEffect(() => {
    if (!showFilters) {
      setFilterPanelLayout(null)
      return
    }
    if (!reportColumnRef.current) {
      setFilterPanelLayout(null)
      return
    }
    function measure(): void {
      const node = reportColumnRef.current
      if (!node) return
      const r = node.getBoundingClientRect()
      const margin = 12
      const width = Math.min(400, Math.max(280, r.width - margin * 2))
      const right = Math.max(margin, window.innerWidth - r.right + margin)
      const top = Math.max(margin, r.top + margin)
      const maxHeight = `min(34rem, calc(100vh - ${top + margin}px))`
      setFilterPanelLayout({ position: "fixed", top, right, width, maxHeight })
    }
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [showFilters])

  const [dateLabel, setDateLabel] = useState("")

  useEffect(() => {
    const first = days[0]?.dateLabel ?? ""
    const last = days[days.length - 1]?.dateLabel ?? ""
    setDateLabel(first && last ? `${first} - ${last}` : "")
  }, [days])

  const [enabledPeriodCols, setEnabledPeriodCols] = useState<Set<string>>(
    () => new Set(savedView?.enabledPeriodCols ?? DEFAULT_PERIOD_COLS)
  )
  const [enabledMemberCols, setEnabledMemberCols] = useState<Set<string>>(
    () => new Set(savedView?.enabledMemberCols ?? DEFAULT_PERIOD_COLS)
  )
  const [columnPickerScope, setColumnPickerScope] = useState<"period" | "member">("period")
  const [sortKey, setSortKey] = useState<string>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const [rosterNames, setRosterNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    getMembers({ fields: ["name"], singlePage: true, limit: 500 })
      .then((members) => {
        if (cancelled) return
        setRosterNames(members.map((m) => m.name).filter(Boolean))
      })
      .catch(() => {
        // Filter falls back to whoever has activity in-range - not fatal.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const memberFilterOptions = useMemo(() => getMemberFilterOptions(memberRows, rosterNames), [memberRows, rosterNames])
  const projectFilterOptions = useMemo(() => getProjectFilterOptions(memberRows), [memberRows])

  const displayRows = useMemo(() => {
    const noFilters =
      memberFilter === ALL_MEMBERS_VALUE && projectFilter === ALL_PROJECTS_VALUE && trackedTimeFilter === "all"
    const filtered = noFilters
      ? days
      : days.filter(
          (d) => getFilteredSubRows(d.date, memberFilter, memberRows, projectFilter, trackedTimeFilter).length > 0
        )
    return filtered.map((d) => buildDisplayDay(d, memberFilter, memberRows, projectFilter, trackedTimeFilter))
  }, [memberFilter, projectFilter, trackedTimeFilter, days, memberRows])

  const totals = useMemo(() => {
    if (displayRows.length === 0) {
      return { time: "00:00:00", activity: 0, spent: "$0.00" }
    }
    const secs = displayRows.reduce((acc, d) => {
      const [h, m, s] = d.totalHours.split(":").map(Number)
      return acc + h * 3600 + m * 60 + s
    }, 0)
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return {
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      activity: Math.round(displayRows.reduce((a, d) => a + d.activityPct, 0) / displayRows.length),
      spent: "$0.00",
    }
  }, [displayRows])

  const sortedDisplayRows = useMemo(() => {
    const rows = [...displayRows]
    rows.sort((a, b) => comparePeriodRows(a, b, sortKey, sortDir))
    return rows
  }, [displayRows, sortKey, sortDir])

  const visibleMetricColumns = useMemo(
    () => TABLE_METRIC_COLUMNS.filter((c) => columnVisibleInTable(enabledPeriodCols, enabledMemberCols, c.key)),
    [enabledPeriodCols, enabledMemberCols]
  )

  function toggleRow(date: string) {
    setExpandedRows((prev) => {
      const s = new Set(prev)
      s.has(date) ? s.delete(date) : s.add(date)
      return s
    })
  }

  function toggleCol(key: string) {
    const setter = columnPickerScope === "period" ? setEnabledPeriodCols : setEnabledMemberCols
    setter((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return s
    })
  }

  function handleSortClick(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const pickerEnabledCols = columnPickerScope === "period" ? enabledPeriodCols : enabledMemberCols

  function clearFilters() {
    setProjectFilter(ALL_PROJECTS_VALUE)
    setTrackedTimeFilter("all")
  }

  function saveView() {
    const view: SavedView = {
      groupBy,
      memberFilter,
      enabledPeriodCols: [...enabledPeriodCols],
      enabledMemberCols: [...enabledMemberCols],
      projectFilter,
      trackedTimeFilter,
    }
    try {
      window.localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(view))
    } catch {
      // Storage unavailable (private browsing, quota) - view just won't persist.
    }
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

  return {
    chartMetrics,
    toggleChartMetric,
    groupBy,
    setGroupBy,
    groupByOptions: GROUP_BY_OPTIONS,
    memberFilter,
    setMemberFilter,
    memberFilterOptions,
    projectFilter,
    setProjectFilter,
    projectFilterOptions,
    trackedTimeFilter,
    setTrackedTimeFilter,
    clearFilters,
    expandedRows,
    toggleRow,
    showColumnPicker,
    setShowColumnPicker,
    showFilters,
    setShowFilters,
    showDatePicker,
    setShowDatePicker,
    filterPortalMounted,
    reportColumnRef,
    filterScrimRef,
    filterPanelLayout,
    dateLabel,
    setDateLabel,
    enabledPeriodCols,
    enabledMemberCols,
    columnPickerScope,
    setColumnPickerScope,
    sortKey,
    sortDir,
    displayRows,
    totals,
    sortedDisplayRows,
    visibleMetricColumns,
    toggleCol,
    handleSortClick,
    pickerEnabledCols,
    getSubRowsForDay: (date: string) =>
      getFilteredSubRows(date, memberFilter, memberRows, projectFilter, trackedTimeFilter),
    saveView,
    justSaved,
  }
}
