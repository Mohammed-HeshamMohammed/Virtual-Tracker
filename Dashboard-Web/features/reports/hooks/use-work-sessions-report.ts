"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/shared/providers/app"
import { canManageActivityData } from "@/features/auth"
import { WORK_SESSIONS_GROUP_BY_OPTIONS } from "@/features/reports/components/shared/constants"
import {
  aggregateWorkSessionTotals,
  buildDailyAvgActivitySeries,
  exportWorkSessionsToCsv,
  filterWorkSessions,
  groupWorkSessions,
} from "@/features/reports/utils/work-sessions"
import { formatRangeLabel, startOfDay, endOfDay, formatDecimalHoursClock, toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity"
import { deleteWorkSession, fetchWorkSessionsReport } from "@/features/reports/api/misc-reports-api"
import { getMembers } from "@/features/members/api/member-api"
import type {
  WorkSessionColumnKey,
  WorkSessionGroupBy,
  WorkSessionRow,
  WorkSessionScope,
} from "@/features/reports/models/work-sessions"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  STANDARD_REPORT_ORG_LABEL,
  WORK_SESSIONS_TIMEZONE_LABEL,
} from "@/features/reports/components/shared/constants"
import { formatWorkSessionDuration } from "@/features/reports/utils/work-sessions"
import { parseTimeToSeconds } from "@/features/reports/utils/time-and-activity/row-aggregate"

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
  const { memberId, memberRole } = useAuth()
  const canDelete = canManageActivityData(memberRole ?? "")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [scope, setScope] = useState<WorkSessionScope>("all")
  const [rangeStart, setRangeStart] = useState(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - 6)
    return d
  })
  const [rangeEnd, setRangeEnd] = useState(() => endOfDay(new Date()))
  const [rows, setRows] = useState<WorkSessionRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
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

  useEffect(() => {
    let cancelled = false
    const from = toDateParam(rangeStart)
    const to = toDateParam(rangeEnd)
    setLoading(true)
    setError(null)
    fetchWorkSessionsReport({ from, to })
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows)
          setTruncated(data.truncated)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd, reloadKey])

  const projectOptions = useMemo(() => {
    const s = new Set<string>()
    rows.forEach((r) => s.add(r.projectName))
    return [...s].sort()
  }, [rows])

  const [rosterNames, setRosterNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    getMembers({ fields: ["name"], singlePage: true, limit: 500 })
      .then((members) => {
        if (cancelled) return
        setRosterNames(members.map((m) => m.name).filter(Boolean))
      })
      .catch(() => {
        // Filter falls back to whoever has sessions in-range - not fatal.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const memberOptions = useMemo(() => {
    const s = new Set<string>(rosterNames)
    rows.forEach((r) => s.add(r.memberName))
    return [...s].sort()
  }, [rows, rosterNames])

  const filteredRows = useMemo(
    () =>
      filterWorkSessions(rows, {
        scope,
        rangeStart,
        rangeEnd,
        projectNames: projectFilter,
        memberNames: memberFilter,
        viewerMemberId: memberId ?? null,
      }),
    [rows, scope, rangeStart, rangeEnd, projectFilter, memberFilter, memberId]
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

  const deleteSession = useCallback(async (id: string) => {
    setDeleteError(null)
    setDeletingId(id)
    try {
      await deleteWorkSession(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete this session.")
    } finally {
      setDeletingId(null)
    }
  }, [])

  const downloadCsv = useCallback(() => {
    const csv = exportWorkSessionsToCsv(filteredRows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `work-sessions-${todayDateParam()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredRows])

  const downloadPdf = useCallback(() => {
    const byMemberSeconds = new Map<string, number>()
    filteredRows.forEach((r) => {
      byMemberSeconds.set(r.memberName, (byMemberSeconds.get(r.memberName) ?? 0) + parseTimeToSeconds(r.durationHms))
    })
    downloadReportPdf({
      title: "Work Sessions Report",
      subtitle: "Start and stop times for team members.",
      orgLabel: STANDARD_REPORT_ORG_LABEL,
      timezoneLabel: WORK_SESSIONS_TIMEZONE_LABEL,
      rangeLabel: dateLabel,
      summary: [
        { label: "Time", value: formatWorkSessionDuration(totals.timeSec) },
        { label: "Break time", value: totals.breakSec > 0 ? formatWorkSessionDuration(totals.breakSec) : "—" },
        { label: "Avg. activity", value: `${totals.avgActivity}%` },
      ],
      charts: [
        ...(activityChartSeries.length > 0
          ? [
              {
                type: "line" as const,
                title: "Average activity by day",
                points: activityChartSeries.map((pt) => ({ label: pt.xShort, value: pt.avgActivity })),
                valueFormatter: (v: number) => `${Math.round(v)}%`,
              },
            ]
          : []),
        ...(byMemberSeconds.size > 0
          ? [
              {
                type: "bar" as const,
                title: "Time by member",
                data: [...byMemberSeconds.entries()]
                  .sort(([, a], [, b]) => b - a)
                  .map(([label, seconds]) => ({ label, value: Math.round((seconds / 3600) * 100) / 100 })),
                valueFormatter: formatDecimalHoursClock,
              },
            ]
          : []),
      ],
      table: {
        columns: [
          { header: "Client", key: "client" },
          { header: "Project", key: "project" },
          { header: "Member", key: "member" },
          { header: "To-do", key: "todo" },
          { header: "Started", key: "started" },
          { header: "Stopped", key: "stopped" },
          { header: "Duration", key: "duration", align: "right" },
          { header: "Activity", key: "activity", align: "right" },
        ],
        rows: filteredRows.map((r) => ({
          client: r.client,
          project: r.projectName,
          member: r.memberName,
          todo: r.todoJob,
          started: r.startedLabel,
          stopped: r.stoppedBy ? `${r.stoppedLabel} (${r.stoppedBy})` : r.stoppedLabel,
          duration: r.durationHms,
          activity: `${r.activityPct}%`,
        })),
        emptyMessage: "No work sessions match the current filters or date range.",
      },
      filename: "work-sessions",
    })
  }, [filteredRows, activityChartSeries, totals, dateLabel])

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
    loading,
    error,
    truncated,
    retry: () => setReloadKey((k) => k + 1),
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
    downloadPdf,
    canDelete,
    deletingId,
    deleteError,
    deleteSession,
  }
}
