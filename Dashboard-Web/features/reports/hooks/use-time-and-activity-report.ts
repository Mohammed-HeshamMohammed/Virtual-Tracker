"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE, GROUP_BY_OPTIONS, TABLE_METRIC_COLUMNS } from "@/features/reports/components/shared/constants"
import { attachForwardWheelToDocument } from "@/features/reports/utils/time-and-activity"
import {
  buildDisplayDay,
  buildGroupedRows,
  comparePeriodRows,
  filterEntries,
  getFilteredSubRows,
  getMemberFilterOptions,
  getProjectFilterOptions,
  groupByColumnLabel,
  type ActivityLevelFilter,
  type ManualTimeFilter,
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
  enabledCols?: string[]
  enabledPeriodCols?: string[]
  enabledMemberCols?: string[]
  projectFilter?: string
  trackedTimeFilter?: TrackedTimeFilter
  manualTimeFilter?: ManualTimeFilter
  activityLevelFilter?: ActivityLevelFilter
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
  range?: { from: string; to: string }
  currentMemberName?: string
}

export function useTimeAndActivityReport({ days, memberRows, entries, range, currentMemberName }: UseTimeAndActivityReportParams) {
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
  const [manualTimeFilter, setManualTimeFilter] = useState<ManualTimeFilter>(savedView?.manualTimeFilter ?? "all")
  const [activityLevelFilter, setActivityLevelFilter] = useState<ActivityLevelFilter>(
    savedView?.activityLevelFilter ?? "all",
  )
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
    if (range) {
      setDateLabel(formatRangeLabel(new Date(`${range.from}T00:00:00`), new Date(`${range.to}T00:00:00`)))
      return
    }
    const first = days[0]?.dateLabel ?? ""
    const last = days[days.length - 1]?.dateLabel ?? ""
    setDateLabel(first && last ? `${first} - ${last}` : "")
  }, [days, range])

  const [enabledCols, setEnabledCols] = useState<Set<string>>(() => {
    const saved = savedView?.enabledCols ?? [
      ...(savedView?.enabledPeriodCols ?? []),
      ...(savedView?.enabledMemberCols ?? []),
    ]
    return new Set(saved.length > 0 ? saved : DEFAULT_PERIOD_COLS)
  })
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

  const memberFilterOptions = useMemo(
    () => getMemberFilterOptions(memberRows, rosterNames, currentMemberName),
    [memberRows, rosterNames, currentMemberName],
  )
  const projectFilterOptions = useMemo(() => getProjectFilterOptions(memberRows), [memberRows])

  const displayRows = useMemo(() => {
    const noFilters =
      memberFilter === ALL_MEMBERS_VALUE &&
      projectFilter === ALL_PROJECTS_VALUE &&
      trackedTimeFilter === "all" &&
      manualTimeFilter === "all" &&
      activityLevelFilter === "all"
    const filtered = noFilters
      ? days
      : days.filter(
          (d) =>
            getFilteredSubRows(
              d.date,
              memberFilter,
              memberRows,
              projectFilter,
              trackedTimeFilter,
              manualTimeFilter,
              activityLevelFilter,
            ).length > 0,
        )
    return filtered.map((d) =>
      buildDisplayDay(
        d,
        memberFilter,
        memberRows,
        projectFilter,
        trackedTimeFilter,
        manualTimeFilter,
        activityLevelFilter,
      ),
    )
  }, [memberFilter, projectFilter, trackedTimeFilter, manualTimeFilter, activityLevelFilter, days, memberRows])

  const groupedResult = useMemo(() => {
    if (groupBy === "date_per_day") return null
    const filtered = filterEntries(
      entries,
      memberFilter,
      projectFilter,
      trackedTimeFilter,
      manualTimeFilter,
      activityLevelFilter,
    )
    return buildGroupedRows(filtered, groupBy)
  }, [groupBy, entries, memberFilter, projectFilter, trackedTimeFilter, manualTimeFilter, activityLevelFilter])

  /**
   * Hours per member, aggregated straight from the filtered entries rather
   * than from whatever the table's sub-rows happen to be.
   *
   * The PDF's "Tracked hours by member" chart used to walk getSubRowsForDay,
   * but a sub-row is only a MEMBER in some grouping modes - group by member
   * or by week and subKeyLabelFor returns PROJECTS (see group-aggregate.ts),
   * so that chart silently plotted project names under a "by member" title.
   * Aggregating here is correct in every mode, and respects the same filters
   * the table does.
   */
  const memberTotals = useMemo(() => {
    const filtered = filterEntries(
      entries,
      memberFilter,
      projectFilter,
      trackedTimeFilter,
      manualTimeFilter,
      activityLevelFilter,
    )
    const byMember = new Map<string, { name: string; hours: number }>()
    for (const e of filtered) {
      const prev = byMember.get(e.memberId)
      // Tracked + manual, matching what the table's own totalHours shows -
      // a member whose day was entirely manual should not plot as zero.
      const hours = (e.activeSeconds + e.manualSeconds) / 3600
      if (prev) prev.hours += hours
      else byMember.set(e.memberId, { name: e.memberName, hours })
    }
    return [...byMember.values()]
      .filter((m) => m.hours > 0)
      .sort((a, b) => b.hours - a.hours)
  }, [entries, memberFilter, projectFilter, trackedTimeFilter, manualTimeFilter, activityLevelFilter])

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

  // fillMissingDays pads the default "Date per day" view with one zeroed
  // row per quiet day so the chart keeps a real x-axis point for every day
  // in the range (see its own doc comment) - the table, CSV and PDF don't
  // share that need and were inheriting the padding anyway, showing a row
  // for a day nobody did anything on. Grouped modes never produce an empty
  // bucket in the first place (buildGroupedRows only creates one per entry
  // it actually sees), so memberCount > 0 is a no-op there.
  const tableDisplayRows = useMemo(
    () => sortedDisplayRows.filter((d) => d.memberCount > 0),
    [sortedDisplayRows],
  )

  // "Showing 14 rows" with every one of them rendered used to be the whole
  // pagination story - fine at 14, not at the hundreds of day/member rows a
  // wide date range or a busy team builds up to. Filtering, grouping or
  // sorting is a deliberate change of what the member is looking at, so it
  // jumps back to page 1 rather than possibly landing on a now out-of-range
  // page of a different result set.
  const [pageSize, setPageSize] = useState(8)
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [memberFilter, projectFilter, trackedTimeFilter, manualTimeFilter, activityLevelFilter, groupBy, sortKey, sortDir, range?.from, range?.to, pageSize])
  const pageCount = Math.max(1, Math.ceil(tableDisplayRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedRows = useMemo(
    () => tableDisplayRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [tableDisplayRows, currentPage, pageSize],
  )

  const visibleMetricColumns = useMemo(
    () => TABLE_METRIC_COLUMNS.filter((c) => enabledCols.has(c.key)),
    [enabledCols]
  )

  function toggleRow(date: string) {
    setExpandedRows((prev) => (prev.has(date) ? new Set() : new Set([date])))
  }

  function toggleCol(key: string) {
    setEnabledCols((prev) => {
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

  function clearFilters() {
    setProjectFilter(ALL_PROJECTS_VALUE)
    setTrackedTimeFilter("all")
    setManualTimeFilter("all")
    setActivityLevelFilter("all")
  }

  return {
    chartMetrics,
    toggleChartMetric,
    memberTotals,
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
    manualTimeFilter,
    setManualTimeFilter,
    activityLevelFilter,
    setActivityLevelFilter,
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
    enabledCols,
    sortKey,
    sortDir,
    displayRows,
    totals,
    sortedDisplayRows,
    tableDisplayRows,
    pagedRows,
    page: currentPage,
    setPage,
    pageCount,
    pageSize,
    setPageSize,
    visibleMetricColumns,
    toggleCol,
    handleSortClick,
    getSubRowsForDay: (date: string) =>
      groupedResult
        ? (groupedResult.subRowsByKey[date] ?? [])
        : getFilteredSubRows(
            date,
            memberFilter,
            memberRows,
            projectFilter,
            trackedTimeFilter,
            manualTimeFilter,
            activityLevelFilter,
          ),
    groupColumnLabel,
  }
}
