/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { Fragment, useEffect, useMemo, useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  LayoutList,
  Menu,
  Search,
} from "lucide-react"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { Button } from "@/shared/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover"
import { AUDIT_LOG_ORG_LABEL, AUDIT_LOG_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"
import {
  exportAuditLogToCsv,
  filterAuditRows,
  groupAuditRowsByDate,
} from "@/features/reports/utils/audit-log"
import { formatRangeLabel, startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import { fetchAuditLogReport } from "@/features/reports/api/misc-reports-api"
import type { AuditLogColumnKey, AuditLogRow } from "@/features/reports/models/audit-log"
import { cn } from "@/shared/utils/utils"
import { usePageSearch } from "@/shared/ui/layout"

const COLUMN_DEFS: { key: AuditLogColumnKey; label: string }[] = [
  { key: "dateLogs", label: "Date & Logs" },
  { key: "author", label: "Author" },
  { key: "time", label: "Time" },
  { key: "action", label: "Action" },
  { key: "object", label: "Object" },
  { key: "member", label: "Member" },
  { key: "detail", label: "Detail" },
]

const DEFAULT_COLS: Record<AuditLogColumnKey, boolean> = {
  dateLogs: true,
  author: true,
  time: true,
  action: true,
  object: true,
  member: true,
  detail: true,
}

const GROUP_OPTIONS: { value: string; label: string }[] = [{ value: "date", label: "Date" }]

function actionBadgeClass(kind: AuditLogRow["actionKind"]): string {
  switch (kind) {
    case "updated":
      return "bg-violet-100 text-violet-800"
    case "created":
      return "bg-emerald-100 text-emerald-800"
    case "deleted":
      return "bg-red-100 text-red-800"
    case "archived":
    default:
      return "bg-slate-100 text-slate-700"
  }
}

/** One checkbox group in the audit Filters panel. */
function AuditFacet({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string
  values: string[]
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  if (values.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</div>
      <div className="space-y-0.5">
        {values.map((value) => {
          const on = selected.has(value)
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span
                className={
                  on
                    ? "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-sky-500 bg-sky-500 text-[10px] font-bold text-white"
                    : "flex h-4 w-4 shrink-0 rounded border border-slate-300 bg-white"
                }
              >
                {on ? "✓" : ""}
              </span>
              <span className="truncate">{value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AuditLogReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { query: search, setQuery: setSearch } = usePageSearch()
  const [rangeStart, setRangeStart] = useComponentState(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - 6)
    return d
  })
  const [rangeEnd, setRangeEnd] = useComponentState(() => endOfDay(new Date()))
  const [rows, setRows] = useComponentState<AuditLogRow[]>([])
  const [showDatePicker, setShowDatePicker] = useComponentState(false)
  const [showFilters, setShowFilters] = useComponentState(false)
  const [authorFilter, setAuthorFilter] = useComponentState<Set<string>>(() => new Set())
  const [actionFilter, setActionFilter] = useComponentState<Set<string>>(() => new Set())
  const authorOptions = useMemo(
    () => [...new Set(rows.map((r) => r.author).filter(Boolean))].sort(),
    [rows]
  )
  const actionOptions = useMemo(
    () => [...new Set(rows.map((r) => r.action).filter(Boolean))].sort(),
    [rows]
  )
  const [groupBy, setGroupBy] = useComponentState<string>("date")
  const [columns, setColumns] = useComponentState<Record<AuditLogColumnKey, boolean>>({ ...DEFAULT_COLS })
  const [collapsed, setCollapsed] = useComponentState<Set<string>>(() => new Set())

  const dateLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    fetchAuditLogReport({ from, to }).then((data) => {
      if (!cancelled) setRows(data)
    })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd])

  const filtered = useMemo(
    () =>
      filterAuditRows(rows, {
        query: search,
        rangeStart,
        rangeEnd,
        authors: authorFilter,
        actions: actionFilter,
      }),
    [rows, search, rangeStart, rangeEnd, authorFilter, actionFilter]
  )

  const groups = useMemo(() => groupAuditRowsByDate(filtered), [filtered])

  const visibleCols = COLUMN_DEFS.filter((c) => columns[c.key])
  const colCount = Math.max(visibleCols.length, 1)

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function downloadCsv() {
    const csv = exportAuditLogToCsv(filtered)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleColumn(k: AuditLogColumnKey) {
    setColumns((p) => {
      const next = !p[k]
      if (!next) {
        const remaining = (Object.keys(p) as AuditLogColumnKey[]).filter((key) => key !== k && p[key])
        if (remaining.length === 0) return p
      }
      return { ...p, [k]: next }
    })
  }

  const eventWord = filtered.length === 1 ? "event" : "events"

  return (
    <div className="relative isolate mx-auto max-w-[1400px] space-y-5">
      
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-medium text-slate-800">Audit log</h1>
        <div className="relative w-full max-w-md shrink-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members or event details"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" aria-label="Interactive control"
          />
        </div>
      </div>

      <div>
        <div className="text-xl font-bold text-slate-900">{AUDIT_LOG_ORG_LABEL}</div>
        <div className="text-sm text-slate-500">{AUDIT_LOG_TIMEZONE_LABEL}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative z-40">
          <button
            type="button"
            onClick={() => setShowDatePicker((v) => !v)}
            className={cn(
              "flex min-w-[260px] items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50",
              showDatePicker ? "border-sky-500 ring-1 ring-sky-500" : "border-slate-200"
            )}
          >
            <span className="truncate">{dateLabel}</span>
            <Calendar className="h-4 w-4 shrink-0 text-sky-500" />
          </button>
          <AnimatePresence>
            {showDatePicker ? (
              <ReportDateRangePicker
                key={`${rangeStart.getTime()}-${rangeEnd.getTime()}`}
                initialStart={rangeStart}
                initialEnd={rangeEnd}
                onApplyRange={(s, e) => {
                  setRangeStart(s)
                  setRangeEnd(e)
                }}
                onApply={() => setShowDatePicker(false)}
                onDismiss={() => setShowDatePicker(false)}
              />
            ) : null}
          </AnimatePresence>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-600"
        >
          Filters
          <ChevronDown className="h-4 w-4 opacity-90" />
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Menu className="h-4 w-4 text-slate-500" />
          <span className="text-sm text-slate-600">Group by</span>
          <ReportSimpleDropdown
            value={groupBy}
            onChange={setGroupBy}
            options={GROUP_OPTIONS}
            width="w-36"
            accentBar={false}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            Export
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600"
              >
                <LayoutList className="h-4 w-4" strokeWidth={2} />
                Columns
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Columns</div>
              <div className="space-y-1">
                {COLUMN_DEFS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleColumn(c.key)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    {c.label}
                    <span className="text-xs text-slate-400">{columns[c.key] ? "On" : "Off"}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {visibleCols.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <Fragment key={g.dateKey}>
                  <tr className="bg-slate-50/90">
                    <td colSpan={colCount} className="px-2 py-0">
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.dateKey)}
                        className="flex w-full items-center gap-2 px-2 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-100/80"
                      >
                        {collapsed.has(g.dateKey) ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        {g.label}
                      </button>
                    </td>
                  </tr>
                  {!collapsed.has(g.dateKey)
                    ? g.rows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          {columns.dateLogs ? (
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">#{r.id}</td>
                          ) : null}
                          {columns.author ? (
                            <td className="px-4 py-3 text-slate-800">{r.author}</td>
                          ) : null}
                          {columns.time ? (
                            <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.timeLabel}</td>
                          ) : null}
                          {columns.action ? (
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                  actionBadgeClass(r.actionKind)
                                )}
                              >
                                {r.action}
                              </span>
                            </td>
                          ) : null}
                          {columns.object ? <td className="px-4 py-3 text-slate-700">{r.object}</td> : null}
                          {columns.member ? <td className="px-4 py-3 text-slate-600">{r.member}</td> : null}
                          {columns.detail ? <td className="max-w-md px-4 py-3 text-slate-700">{r.detail}</td> : null}
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-16 text-center text-sm text-slate-500">
                    No events match your search or date range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          Showing {filtered.length} {eventWord}
        </p>
        <div className="flex items-center gap-1">
          <span className="inline-flex min-w-8 items-center justify-center border-b-2 border-sky-500 pb-1 text-sm font-semibold text-sky-600">
            1
          </span>
        </div>
      </div>

      <AnimatePresence>
        {showFilters ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/20"
              onClick={() => setShowFilters(false)}
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className="fixed right-6 top-24 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            >
              <div className="mb-3 text-sm font-semibold text-slate-800">Filters</div>
              {/* Author/action values come from the loaded rows themselves, so the
                  panel can only ever offer filters that match real audit data. */}
              <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                <AuditFacet
                  title="Author"
                  values={authorOptions}
                  selected={authorFilter}
                  onToggle={(value) => {
                    const next = new Set(authorFilter)
                    if (next.has(value)) next.delete(value)
                    else next.add(value)
                    setAuthorFilter(next)
                  }}
                />
                <AuditFacet
                  title="Action"
                  values={actionOptions}
                  selected={actionFilter}
                  onToggle={(value) => {
                    const next = new Set(actionFilter)
                    if (next.has(value)) next.delete(value)
                    else next.add(value)
                    setActionFilter(next)
                  }}
                />
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setAuthorFilter(new Set())
                    setActionFilter(new Set())
                  }}
                >
                  Clear
                </Button>
                <Button type="button" className="flex-1 bg-sky-500 hover:bg-sky-600" onClick={() => setShowFilters(false)}>
                  Done
                </Button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

