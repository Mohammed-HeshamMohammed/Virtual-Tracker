/* eslint-disable react-doctor/no-initialize-state, react-doctor/no-derived-state */
"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE, GROUP_BY_OPTIONS, TABLE_METRIC_COLUMNS } from "@/features/reports/components/shared/constants"
import { attachForwardWheelToDocument } from "@/features/reports/utils/time-and-activity"
import {
  buildDisplayDay,
  buildGroupedRows,
  columnVisibleInTable,
  comparePeriodRows,
  filterEntries,
  getFilteredSubRows,
  getMemberFilterOptions,
  getProjectFilterOptions,
  groupByColumnLabel,
  type TrackedTimeFilter,
} from "@/features/reports/utils/time-and-activity"
import type { TimeActivityGroupBy, TimeActivityMetric, TimeActivityReportData } from "@/features/reports/models/time-and-activity"
import { getMembers } from "@/features/members/api/member-api"
import { formatRangeLabel } from "@/features/reports/utils/time-and-activity"
import { sumMoneyStrings } from "@/features/reports/utils/money"

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

export type UseTimeAndActivityReportParams = TimeActivityReportData & {
  /** 'YYYY-MM-DD' bounds of what was actually requested - see dateLabel below. */
  range?: { from: string; to: string }
}

export function useTimeAndActivityReport({ days, memberRows, entries, range }: UseTimeAndActivityReportParams) {
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

  // Derived from the range actually requested, not from `days` - `days` only
  // carries dates with at least one tracked session anywhere in the org
  // (build-time-and-activity-rows.js never emits an empty day), so a 7-day
  // selection with a quiet day in the middle used to silently redraw the
  // label around whichever days happened to have data, e.g. "Tue - Fri"
  // for a picked "Mon - Sun" - the label lied about what was actually loaded.
  // Falls back to the old days-derived label only when no range is known
  // yet (defensive; the one real caller always supplies one).
  useEffect(() => {
    if (range) {
      setDateLabel(formatRangeLabel(new Date(`${range.from}T00:00:00`), new Date(`${range.to}T00:00:00`)))
      return
    }
    const first = days[0]?.dateLabel ?? ""
    const last = days[days.length - 1]?.dateLabel ?? ""
    setDateLabel(first && last ? `${first} - ${last}` : "")
  }, [days, range])

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

  // Every mode besides the default "Date per day" re-aggregates from
  // `entries` (day+member+project granularity) instead of the day/member
  // rows above, which can't be regrouped by project/client/team - see
  // group-aggregate.ts's own doc comment on why. Falls back to the
  // existing day-based rows (and getFilteredSubRows below) when `entries`
  // is empty (an older cached view, or a demo/builder caller) so grouping
  // degrades to "nothing to show" rather than throwing.
  const groupedResult = useMemo(() => {
    if (groupBy === "date_per_day") return null
    const filtered = filterEntries(entries, memberFilter, projectFilter, trackedTimeFilter)
    return buildGroupedRows(filtered, groupBy)
  }, [groupBy, entries, memberFilter, projectFilter, trackedTimeFilter])

  const groupColumnLabel = groupByColumnLabel(groupBy)

  const activeRows = groupedResult ? groupedResult.rows : displayRows

  const totals = useMemo(() => {
    if (activeRows.length === 0) {
      return { time: "00:00:00", activity: 0, spent: "$0.00" }
    }
    const secs = activeRows.reduce((acc, d) => {
      const [h, m, s] = d.totalHours.split(":").map(Number)
      return acc + h * 3600 + m * 60 + s
    }, 0)
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    // Was hardcoded to "$0.00" unconditionally - every row already carries a
    // real totalSpent the table renders correctly per-day, it just never got
    // summed into this card. Summed off each row's own totalSpent string
    // (sumMoneyStrings), not getMetricNumeric's raw-number parse - a row can
    // itself already be a "$300.00 + EGP 200.00" mixed-currency total (see
    // toDayRow), and summing raw numbers across rows paid in different
    // currencies would add amounts that aren't the same unit.
    const spent = sumMoneyStrings(activeRows.map((d) => d.totalSpent))
    return {
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      activity: Math.round(activeRows.reduce((a, d) => a + d.activityPct, 0) / activeRows.length),
      spent,
    }
  }, [activeRows])

  const sortedDisplayRows = useMemo(() => {
    const rows = [...activeRows]
    rows.sort((a, b) => comparePeriodRows(a, b, sortKey, sortDir))
    return rows
  }, [activeRows, sortKey, sortDir])

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
      groupedResult
        ? (groupedResult.subRowsByKey[date] ?? [])
        : getFilteredSubRows(date, memberFilter, memberRows, projectFilter, trackedTimeFilter),
    groupColumnLabel,
    saveView,
    justSaved,
  }
}
