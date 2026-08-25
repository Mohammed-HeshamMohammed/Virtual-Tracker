"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useActivityFeed } from "@/features/activity/hooks/use-activity-feed"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { useActivityShell, useActivityShellRegistration } from "@/features/activity/components/activity-shell-context"
import { useAuth } from "@/shared/providers/app"
import { canClassifyActivity, canExportActivity, canManageActivityData } from "@/features/auth"
import { motion } from "framer-motion"
import { Globe, ExternalLink, Tag, TrendingUp, TrendingDown, Eye } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  ActivityDayEmptyState,
  ActivityLoadingState,
  ActivitySearchEmptyState,
} from "@/features/activity/components/activity-page-states"
import { ActivitySection } from "@/features/activity/components/activity-section"
import { ClassificationDialog } from "@/features/activity/components/classification-dialog"
import {
  activityCategoryBadgeClass,
  activityCategoryColor,
  activityCategoryLabel,
  normalizeActivityCategory,
  type ActivityCategory,
} from "@/features/activity/utils/activity-categories"
import { usePaginatedTable } from "@/shared/tables/hooks/use-paginated-table"
import { TablePagination } from "@/shared/tables/ui"

const ACTIVITY_TABLE_ROWS_PER_PAGE = 10

interface URLUsage {
  id: string
  domain: string
  url: string
  category: ActivityCategory
  totalTime: string
  visits: number
  avgTime: string
  lastVisit: string
  sourceKind?: "url" | "window"
}

// Shared with the Apps page and the classify dialog - see
// activity-categories.ts for why these stopped being local.
const getCategoryColor = activityCategoryColor
const getCategoryBadge = activityCategoryBadgeClass

export function ActivityURLsContent() {
  const { memberRole } = useAuth()
  const canExport = canExportActivity(memberRole)
  const canManage = canManageActivityData(memberRole)
  const canClassify = canClassifyActivity(memberRole)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const { day, searchQuery, selectedCategory, showBlocked, sortOrder } = useActivityShell()
  const periodLabel = day.dayMode === "all" ? "all days" : day.selectedDayLabel
  const { scope } = useActivityFeedContext()
  const { data: liveUrls, loading, reload } = useActivityFeed<URLUsage[]>("urls", { day: day.dayKey })
  const memberOpts = scope?.members ?? []

  const urlsSource = useMemo(
    () => (liveUrls ?? []).map((url) => ({ ...url, category: normalizeActivityCategory(url.category) })),
    [liveUrls],
  )

  const categoryFiltered =
    selectedCategory === "all" ? urlsSource : urlsSource.filter((url) => url.category === selectedCategory)
  const blockedFiltered = showBlocked
    ? categoryFiltered.filter((url) => url.category === "distracting")
    : categoryFiltered
  const searchLower = searchQuery.trim().toLowerCase()
  const filteredURLs = useMemo(() => {
    const searched = searchLower
      ? blockedFiltered.filter(
          (url) =>
            url.domain.toLowerCase().includes(searchLower) ||
            url.url.toLowerCase().includes(searchLower) ||
            url.category.toLowerCase().includes(searchLower),
        )
      : blockedFiltered
    if (sortOrder === "name") {
      return [...searched].sort((a, b) => a.domain.localeCompare(b.domain))
    }
    return [...searched].sort((a, b) => b.visits - a.visits)
  }, [blockedFiltered, searchLower, sortOrder])
  const hasData = urlsSource.length > 0
  const tableRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, rowsPerPage } =
    usePaginatedTable(filteredURLs, ACTIVITY_TABLE_ROWS_PER_PAGE)
  const showDayEmpty = !loading && !hasData
  const showSearchEmpty = !loading && hasData && filteredURLs.length === 0
  const showMainContent = !loading && hasData && !showSearchEmpty

  const totalVisits = urlsSource.reduce((acc, url) => acc + url.visits, 0)
  const urlCount = urlsSource.length
  const productiveCount = urlsSource.filter((u) => u.category === "productive").length
  const neutralCount = urlsSource.filter((u) => u.category === "neutral").length
  const blockedCount = urlsSource.filter((u) => u.category === "distracting").length

  const handleExport = useCallback(async () => {
    if (!canExport) return
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    
    // URLs sheet
    const urlsSheet = workbook.addWorksheet("URLs")
    urlsSheet.columns = [
      { header: "Domain", key: "domain", width: 25 },
      { header: "URL", key: "url", width: 40 },
      { header: "Category", key: "category", width: 15 },
      { header: "Total Time", key: "totalTime", width: 15 },
      { header: "Visits", key: "visits", width: 10 },
      { header: "Avg Time", key: "avgTime", width: 12 },
      { header: "Last Visit", key: "lastVisit", width: 20 },
    ]
    
    const urlRows = filteredURLs.map((url) => ({
      domain: url.domain,
      url: url.url,
      category: url.category,
      totalTime: url.totalTime,
      visits: url.visits,
      avgTime: url.avgTime,
      lastVisit: url.lastVisit,
    }))
    
    urlRows.forEach(row => urlsSheet.addRow(row))
    
    // Add metadata to URLs sheet
    urlsSheet.addRow({})
    urlsSheet.addRow(["Period", day.selectedDayLabel])
    urlsSheet.addRow(["Category Filter", selectedCategory])
    urlsSheet.addRow(["Exported At", new Date().toLocaleString()])
    
    // Members sheet
    const membersSheet = workbook.addWorksheet("Members")
    membersSheet.columns = [
      { header: "Member", key: "member", width: 20 },
      { header: "Productivity", key: "productivity", width: 15 },
      { header: "Total Time", key: "totalTime", width: 15 },
      { header: "Top Domain", key: "topDomain", width: 25 },
      { header: "Productive Sites", key: "productiveSites", width: 18 },
      { header: "Unproductive Sites", key: "unproductiveSites", width: 20 },
    ]
    
    memberOpts.forEach((member) => {
      membersSheet.addRow({ member: member.name })
    })
    
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `url-usage-${day.dayKey}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [canExport, day.dayKey, day.selectedDayLabel, filteredURLs, memberOpts, selectedCategory])

  useActivityShellRegistration({
    onRefresh: () => {
      void reload({ force: true })
    },
    onExport: canExport
      ? () => {
          void handleExport()
        }
      : undefined,
  })

  return (
    <>
      {canClassify ? (
        <ClassificationDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          matchType="domain"
          items={urlsSource.map((url) => ({ pattern: url.domain, label: url.domain, category: url.category }))}
          onSaved={() => {
            void reload({ force: true })
          }}
        />
      ) : null}

      {loading ? <ActivityLoadingState label="Loading URL activity…" /> : null}

      {!loading && showDayEmpty ? (
        <ActivityDayEmptyState
          icon={Globe}
          title="No URL activity for this day"
          description="URLs appear when the desktop agent reads the browser address bar, or from browser window titles when the address bar cannot be read. Keep the agent running with the timer active while browsing."
        />
      ) : null}

      {!loading && showSearchEmpty ? (
        <ActivitySearchEmptyState entityLabel="URLs" />
      ) : null}

      {!loading && showMainContent ? (
        <div className="space-y-8">
          <ActivitySection
            title="Website records"
            description={`${filteredURLs.length} site${filteredURLs.length !== 1 ? "s" : ""} for ${periodLabel}`}
            action={
              canClassify ? (
                <button
                  type="button"
                  onClick={() => setClassifyOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Tag className="h-3.5 w-3.5" />
                  Classify sites
                </button>
              ) : null
            }
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
            >
              <table className="w-full min-w-[720px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Site / title
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Time
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Visits
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Category
                      </th>
                      {canManage ? (
                        <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {visibleRows.map((url, index) => (
                      <motion.tr
                        key={url.url || `${url.domain}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white",
                                getCategoryColor(url.category),
                              )}
                            >
                              <Globe className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{url.domain}</p>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400 max-w-[320px]">{url.url}</p>
                              {url.sourceKind === "window" ? (
                                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                  Window title
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{url.totalTime}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Avg: {url.avgTime}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">{url.visits}</td>
                        <td className="px-5 py-4">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                              getCategoryBadge(url.category),
                            )}
                          >
                            {activityCategoryLabel(url.category)}
                          </span>
                        </td>
                        {canManage ? (
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-1">
                              {url.sourceKind !== "window" && /^https?:\/\//i.test(url.url) ? (
                                <a
                                  href={url.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-lg p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                                </a>
                              ) : (
                                <button type="button" className="rounded-lg p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800" disabled>
                                  <ExternalLink className="h-4 w-4 text-slate-300 dark:text-slate-700" />
                                </button>
                              )}
                              {/* URL blocking has no backing table or endpoint yet, so the
                                  button is not rendered - it previously looked actionable
                                  (permission-gated, hover state) and did nothing on click. */}
                            </div>
                          </td>
                        ) : null}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              {filteredURLs.length > 0 ? (
                <TablePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filteredURLs.length}
                  rowsPerPage={rowsPerPage}
                  onPageChange={setCurrentPage}
                />
              ) : null}
            </motion.div>
          </ActivitySection>

          <ActivitySection title="Summary">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Productive</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{productiveCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Globe className="w-5 h-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Neutral</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{neutralCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/80 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Blocked</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{blockedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/80 flex items-center justify-center">
              <Eye className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Sites / Visits</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{urlCount} / {totalVisits}</p>
            </div>
          </div>
        </div>
      </motion.div>
          </ActivitySection>

          {memberOpts.length > 0 ? (
            <ActivitySection title="Members with activity" description="Use the member filter above to narrow results">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
              >
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {memberOpts.map((member, index) => (
                    <motion.div
                      key={String(member.id ?? index)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.03 + index * 0.03 }}
                      className="p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-200">
                          {member.initials}
                        </div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{member.name}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </ActivitySection>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

