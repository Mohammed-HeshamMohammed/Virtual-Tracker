"use client"

import { useEffect, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchAppsUrlsReport } from "@/features/reports/api/misc-reports-api"
import {
  ReportFiltersPanel,
  emptyReportFilters,
  useReportFilterOptions,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { AppUsageRow, UrlUsageRow } from "@/features/reports/models/apps-urls"
import { cn } from "@/shared/utils/utils"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, STANDARD_REPORT_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"

function UsageTable<T extends { memberName: string; durationHms: string }>({
  title,
  rows,
  labelHeader,
  getLabel,
}: {
  title: string
  rows: T[]
  labelHeader: string
  getLabel: (row: T) => string
}) {
  const { isDark } = useTheme()
  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <div className={cn("border-b px-4 py-3 text-sm font-semibold", isDark ? "border-white/10 text-[#dce1fb]" : "border-slate-100 text-slate-800")}>
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Member</th>
            <th className={th}>{labelHeader}</th>
            <th className={cn(th, "text-right")}>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className={cn("px-4 py-8 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No activity in this date range.
              </td>
            </tr>
          ) : null}
          {rows.map((row, i) => (
            <tr key={`${row.memberName}-${getLabel(row)}-${i}`} className={cn(
              "border-b transition-colors last:border-b-0",
              isDark ? "border-white/10 hover:bg-white/2" : "border-slate-100 hover:bg-slate-50/80"
            )}>
              <td className={cn("px-4 py-3", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{row.memberName}</td>
              <td className={cn("px-4 py-3", isDark ? "text-[#bccbb9]" : "text-slate-600")}>{getLabel(row)}</td>
              <td className={cn("px-4 py-3 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{row.durationHms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AppsUrlsTables({ filters }: { filters: ReportFilterState }) {
  const { rangeStart, rangeEnd, dateLabel, registerExportHandler, registerPdfExportHandler } = useStandardReportLayout()
  const [apps, setApps] = useState<AppUsageRow[]>([])
  const [urls, setUrls] = useState<UrlUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  // A failed read used to be indistinguishable from an empty report:
  // getJson swallowed every error and both tables rendered "no rows".
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    setLoading(true)
    setError(null)
    fetchAppsUrlsReport({ from, to, memberIds: [...filters.memberIds], projectIds: [...filters.projectIds] })
      .then((data) => {
        if (!cancelled) {
          setApps(data.apps)
          setUrls(data.urls)
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
      const header = ["Type", "Member", "App/Domain", "Time"]
      const appRows = apps.map((a) => [header[0]!, a.memberName, a.appName, a.durationHms])
      const urlRows = urls.map((u) => ["URL", u.memberName, u.domain, u.durationHms])
      const csv = [header, ...appRows, ...urlRows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `apps-urls-${new Date().toISOString().slice(0, 10)}.csv`
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
        timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
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
                  valueFormatter: (v) => `${v}h`,
                },
              ]
            : undefined,
        table: {
          columns: [
            { header: "Type", key: "type" },
            { header: "Member", key: "member" },
            { header: "App / Domain", key: "target" },
            { header: "Time", key: "time", align: "right" },
          ],
          rows: [
            ...apps.map((a) => ({ type: "App", member: a.memberName, target: a.appName, time: a.durationHms })),
            ...urls.map((u) => ({ type: "URL", member: u.memberName, target: u.domain, time: u.durationHms })),
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
      <UsageTable title="Apps" rows={apps} labelHeader="App" getLabel={(r) => r.appName} />
      <UsageTable title="URLs" rows={urls} labelHeader="Domain" getLabel={(r) => r.domain} />
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
      showGroupBy={false}
      filtersPanel={(close) => (
        <ReportFiltersPanel onClose={close} options={options} value={filters} onChange={setFilters} />
      )}
    >
      <AppsUrlsTables filters={filters} />
    </StandardReportLayout>
  )
}
