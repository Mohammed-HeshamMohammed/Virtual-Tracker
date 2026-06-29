"use client"

import { useCallback, useMemo, useState } from "react"
import {
  WORK_SESSIONS_DEMO_ROWS,
  WORK_SESSIONS_GROUP_BY_OPTIONS,
} from "@/features/reports/components/shared/constants"
import {
  aggregateWorkSessionTotals,
  buildDailyAvgActivitySeries,
  exportWorkSessionsToCsv,
  filterWorkSessions,
  groupWorkSessions,
} from "@/features/reports/utils/work-sessions"
import { formatRangeLabel, startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import type { WorkSessionColumnKey, WorkSessionGroupBy, WorkSessionScope } from "@/features/reports/models/work-sessions"

const DEFAULT_COLS: Record<WorkSessionColumnKey, boolean> = {
  client: true,
  project: true,
  member: true,
  todo: true,
  manual: true,
  started: true,
  stopped: true,
  duration: true,
  activity: true,
}

export function useWorkSessionsReport() {
  const [scope, setScope] = useState<WorkSessionScope>("all")
  const [rangeStart, setRangeStart] = useState(() => new Date(2026, 3, 6))
  const [rangeEnd, setRangeEnd] = useState(() => new Date(2026, 3, 12))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [groupBy, setGroupBy] = useState<WorkSessionGroupBy>("date")
  const [showActivityChart, setShowActivityChart] = useState(true)
  const [tableCollapsed, setTableCollapsed] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [projectFilter, setProjectFilter] = useState<Set<string> | null>(null)
  const [memberFilter, setMemberFilter] = useState<Set<string> | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [columnVisibility, setColumnVisibility] = useState<Record<WorkSessionColumnKey, boolean>>(() => ({
    ...DEFAULT_COLS,
  }))

  const dateLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  const projectOptions = useMemo(() => {
    const s = new Set<string>()
    WORK_SESSIONS_DEMO_ROWS.forEach((r) => s.add(r.projectName))
    return [...s].sort()
  }, [])

  const memberOptions = useMemo(() => {
    const s = new Set<string>()
    WORK_SESSIONS_DEMO_ROWS.forEach((r) => s.add(r.memberName))
    return [...s].sort()
  }, [])

  const filteredRows = useMemo(
    () =>
      filterWorkSessions(WORK_SESSIONS_DEMO_ROWS, {
        scope,
        rangeStart,
        rangeEnd,
        projectNames: projectFilter,
        memberNames: memberFilter,
      }),
    [scope, rangeStart, rangeEnd, projectFilter, memberFilter]
  )

  const grouped = useMemo(() => groupWorkSessions(filteredRows, groupBy), [filteredRows, groupBy])

  const totals = useMemo(() => aggregateWorkSessionTotals(filteredRows), [filteredRows])

  const activityChartSeries = useMemo(
    () => buildDailyAvgActivitySeries(filteredRows, rangeStart, rangeEnd),
    [filteredRows, rangeStart, rangeEnd]
  )

  function shiftRangeByDays(delta: number) {
    const s = new Date(rangeStart)
    s.setDate(s.getDate() + delta)
    const e = new Date(rangeEnd)
    e.setDate(e.getDate() + delta)
    setRangeStart(s)
    setRangeEnd(e)
  }

  function goToToday() {
    const now = new Date()
    setRangeStart(startOfDay(now))
    setRangeEnd(endOfDay(now))
  }

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }, [])

  const toggleColumn = useCallback((k: WorkSessionColumnKey) => {
    setColumnVisibility((p) => {
      const next = !p[k]
      if (!next) {
        const remaining = (Object.keys(p) as WorkSessionColumnKey[]).filter((key) => key !== k && p[key])
        if (remaining.length === 0) return p
      }
      return { ...p, [k]: next }
    })
  }, [])

  const downloadCsv = useCallback(() => {
    const csv = exportWorkSessionsToCsv(filteredRows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `work-sessions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredRows])

  const toggleProject = useCallback(
    (name: string) => {
      setProjectFilter((prev) => {
        if (prev === null) {
          const n = new Set<string>(projectOptions)
          n.delete(name)
          return n
        }
        const n = new Set<string>(prev)
        if (n.has(name)) n.delete(name)
        else n.add(name)
        if (n.size === projectOptions.length) return null
        return n
      })
    },
    [projectOptions]
  )

  const toggleMember = useCallback(
    (name: string) => {
      setMemberFilter((prev) => {
        if (prev === null) {
          const n = new Set<string>(memberOptions)
          n.delete(name)
          return n
        }
        const n = new Set<string>(prev)
        if (n.has(name)) n.delete(name)
        else n.add(name)
        if (n.size === memberOptions.length) return null
        return n
      })
    },
    [memberOptions]
  )

  const selectAllProjects = useCallback(() => setProjectFilter(null), [])
  const selectAllMembers = useCallback(() => setMemberFilter(null), [])
  const clearProjects = useCallback(() => setProjectFilter(null), [])
  const clearMembers = useCallback(() => setMemberFilter(null), [])

  return {
    scope,
    setScope,
    rangeStart,
    rangeEnd,
    setRangeStart,
    setRangeEnd,
    dateLabel,
    showDatePicker,
    setShowDatePicker,
    showFilters,
    setShowFilters,
    groupBy,
    setGroupBy,
    groupByOptions: WORK_SESSIONS_GROUP_BY_OPTIONS,
    showActivityChart,
    setShowActivityChart,
    tableCollapsed,
    setTableCollapsed,
    collapsedGroups,
    toggleGroupCollapsed,
    projectOptions,
    memberOptions,
    projectFilter,
    memberFilter,
    toggleProject,
    toggleMember,
    selectAllProjects,
    selectAllMembers,
    clearProjects,
    clearMembers,
    sendOpen,
    setSendOpen,
    scheduleOpen,
    setScheduleOpen,
    columnVisibility,
    toggleColumn,
    filteredRows,
    activityChartSeries,
    grouped,
    totals,
    shiftRangeByDays,
    goToToday,
    downloadCsv,
  }
}
