"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ChevronDown, LayoutList } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchAppsUrlsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { AppUsageRow, UrlUsageRow, UsageCategory } from "@/features/reports/models/apps-urls"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportSkeleton, ReportTruncationNotice } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  MEMBER_ONLY_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  MEMBER_TIMEZONE_LABEL,
} from "@/features/reports/components/shared/constants"
import { formatDecimalHoursClock, toDateParam, todayDateParam } from "@/features/reports/utils/time-and-activity"
import { groupReportRows } from "@/features/reports/utils/report-grouping"

function keyForUsageGroup<T extends { memberName: string }>(row: T): string {
  return row.memberName
}

const CATEGORY_LABEL: Record<UsageCategory, string> = {
  productive: "Productive",
  neutral: "Neutral",
  distracting: "Distracting",
  unclassified: "Unclassified",
}

function CategoryPill({ category, isDark }: { category: UsageCategory; isDark: boolean }) {
  const tone: Record<UsageCategory, string> = {
    productive: isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700",
    neutral: isDark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700",
    distracting: isDark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700",
    unclassified: isDark ? "bg-white/8 text-white/50" : "bg-slate-100 text-slate-500",
  }
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", tone[category])}>
      {CATEGORY_LABEL[category]}
    </span>
  )
}

function UsageTable<T extends { memberName: string; durationHms: string; category: UsageCategory }>({
  title,
  rows,
  labelHeader,
  getLabel,
  getSubLabel,
  caption,
}: {
  title: string
  rows: T[]
  labelHeader: string
  getLabel: (row: T) => string
  getSubLabel?: (row: T) => string
  caption: string
}) {
  const { isDark } = useTheme()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  const grouped = useMemo(() => groupReportRows(rows, keyForUsageGroup), [rows])
  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <div className={cn("border-b px-4 py-3", isDark ? "border-white/10" : "border-slate-100")}>
        <div className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{title}</div>
        <div className={cn("mt-0.5 text-xs", isDark ? "text-white/40" : "text-slate-500")}>{caption}</div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Member</th>
            <th className={th}>{labelHeader}</th>
            <th className={th}>Category</th>
            <th className={cn(th, "text-right")}>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn("px-4 py-8 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No activity in this date range.
              </td>
            </tr>
          ) : null}
          {grouped.map((g) => (
            <Fragment key={g.key}>
              <tr className={cn(isDark ? "bg-white/10" : "bg-slate-100")}>
                <td colSpan={4} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(g.key)}
                    className={cn(
                      "flex w-full items-center gap-2 text-left text-sm font-medium",
                      isDark ? "text-[#dce1fb]" : "text-slate-800"
                    )}
                  >
                    <LayoutList className={cn("h-4 w-4 shrink-0", isDark ? "text-white/45" : "text-slate-500")} />
                    <span>{g.label}</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 transition-transform",
                        isDark ? "text-white/40" : "text-slate-400",
                        collapsedGroups.has(g.key) && "-rotate-90"
                      )}
                    />
                  </button>
                </td>
              </tr>
              {!collapsedGroups.has(g.key)
                ? g.rows.map((row, i) => (
                    <tr key={`${row.memberName}-${getLabel(row)}-${i}`} className={cn(
                      "border-b transition-colors last:border-b-0",
                      isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
                    )}>
                      <td className={cn("px-4 py-3", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{row.memberName}</td>
                      <td className={cn("px-4 py-3", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                        <div>{getLabel(row)}</div>
                        {getSubLabel?.(row) ? (
                          <div className={cn("text-xs", isDark ? "text-white/35" : "text-slate-400")}>{getSubLabel(row)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3"><CategoryPill category={row.category} isDark={isDark} /></td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{row.durationHms}</td>
                    </tr>
                  ))
                : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AppsUrlsTables({ filters }: { filters: ReportFilterState }) {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [apps, setApps] = useState<AppUsageRow[]>([])
  const [urls, setUrls] = useState<UrlUsageRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const from = toDateParam(rangeStart)
    const to = toDateParam(rangeEnd)
    setLoading(true)
    setError(null)
    fetchAppsUrlsReport({ from, to, memberIds: [...filters.memberIds], projectIds: [...filters.projectIds] })
      .then((data) => {
        if (!cancelled) {
          setApps(data.apps)
          setUrls(data.urls)
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
  }, [rangeStart, rangeEnd, filters, reloadKey])

  useEffect(() => {
    const runExport = () => {
      const header = ["Type", "Member", "App/Domain", "Category", "Identified by", "Time"]
      const appRows = apps.map((a) => ["App", a.memberName, a.appName, a.category, "", a.durationHms])
      const urlRows = urls.map((u) => ["URL", u.memberName, u.domain, u.category, u.identifiedBy, u.durationHms])
      const csv = [header, ...appRows, ...urlRows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `apps-urls-${todayDateParam()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [apps, urls, registerExportHandler])

  useEffect(() => {
    const runPdfExport = () => {
      const byApp = new Map<string, number>()
      apps.forEach((a) => byApp.set(a.appName, (byApp.get(a.appName) ?? 0) + a.totalSeconds))
      downloadReportPdf({
        title: "Apps & URLs Report",
        subtitle: "Apps used and URLs visited while working.",
        orgLabel: STANDARD_REPORT_ORG_LABEL,
        timezoneLabel: MEMBER_TIMEZONE_LABEL,
        rangeLabel: dateLabel,
        charts:
          byApp.size > 0
            ? [
                {
                  type: "bar",
                  title: "Top apps by time",
                  data: [...byApp.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([label, seconds]) => ({ label, value: Math.round((seconds / 3600) * 100) / 100 })),
                  valueFormatter: formatDecimalHoursClock,
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Type", key: "type" },
            { header: "Member", key: "member" },
            { header: "App / Domain", key: "target" },
            { header: "Category", key: "category" },
            { header: "Time", key: "time", align: "right" },
          ],
          rows: [
            ...apps.map((a) => ({ type: "App", member: a.memberName, target: a.appName, category: a.category, time: a.durationHms })),
            ...urls.map((u) => ({ type: "URL", member: u.memberName, target: u.domain, category: u.category, time: u.durationHms })),
          ],
          emptyMessage: "No activity in this date range.",
        },
        filename: "apps-urls",
      })
    }
    registerPdfExportHandler(runPdfExport)
    return () => registerPdfExportHandler(null)
  }, [apps, urls, dateLabel, registerPdfExportHandler])

  if (loading) return <ReportSkeleton rows={5} columns={3} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  return (
    <div className="space-y-6">
      {truncated ? <ReportTruncationNotice /> : null}
      <UsageTable
        title="Apps"
        caption="Time in applications other than a browser."
        rows={apps}
        labelHeader="App"
        getLabel={(r) => r.appName}
      />
      <UsageTable
        title="URLs"
        caption="Browser time, attributed to the site rather than the browser. Apps and URLs no longer overlap - together they are the whole tracked day."
        rows={urls}
        labelHeader="Site"
        getLabel={(r) => r.domain}
        getSubLabel={(r) => (r.identifiedBy === "address bar" ? "" : `Identified by ${r.identifiedBy}`)}
      />
    </div>
  )
}

export function AppsUrlsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilterState>(emptyReportFilters)
  const options = useReportFilterOptions()
  return (
    <StandardReportLayout
      title="Apps & URLs report"
      onNavigate={onNavigate}
      exportFileBaseName="apps-urls"
      pageId="reports-apps-urls"
      showScopeTabs={false}
      showGroupBy={true}
      groupByOptions={MEMBER_ONLY_GROUP_BY_OPTIONS}
      defaultGroupBy="member"
      filtersPanel={(close) => (
        <ReportFiltersPanel onClose={close} options={options} value={filters} onChange={setFilters} />
      )}
    >
      <AppsUrlsTables filters={filters} />
    </StandardReportLayout>
  )
}
