"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useActivityFeed } from "@/features/activity/hooks/use-activity-feed"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { useActivityShell, useActivityShellRegistration } from "@/features/activity/components/activity-shell-context"
import { useAuth, useTheme } from "@/shared/providers/app"
import { canClassifyActivity, canExportActivity } from "@/features/auth"
import { motion } from "framer-motion"
import { Clock, Monitor, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { formatActivityAppName } from "@/features/activity/utils/display-names"
import { ActivityMemberAvatar } from "@/features/activity/components/activity-member-avatar"
import {
  ActivityDayEmptyState,
  ActivityLoadingState,
  ActivitySearchEmptyState,
} from "@/features/activity/components/activity-page-states"
import { ActivitySection } from "@/features/activity/components/activity-section"
import { ReclassificationNotice } from "@/features/activity/components/reclassification-notice"
import { classificationStamp } from "@/features/activity/utils/classification-freshness"
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

interface AppUsage {
  id: string
  name: string
  category: ActivityCategory
  totalTime: string
  percentage: number
  trend: "up" | "down" | "neutral"
  trendValue: string
  sessions: number
  iconDataUrl?: string | null
  /** True when this row's category came from the sites visited rather than
   *  from the app itself - browsers only. */
  viaUrl?: boolean
}

interface MemberAppUsage {
  memberId?: string
  member: string
  avatar: string
  avatarUrl?: string | null
  productiveTime: string
  productivePercent: number
  neutralTime: string
  unproductiveTime: string
  topApp: string
}

const getCategoryColor = activityCategoryColor
const getCategoryBgColor = activityCategoryBadgeClass

/** The app's real icon (reported by the desktop agent) when there is one,
 *  falling back to a category-coloured letter tile. */
function AppIcon({
  name,
  category,
  iconDataUrl,
}: {
  name: string
  category: ActivityCategory
  iconDataUrl?: string | null
}) {
  const [failed, setFailed] = useState(false)
  if (iconDataUrl && !failed) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        <img
          src={iconDataUrl}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm",
        getCategoryColor(category),
      )}
    >
      {name.charAt(0)}
    </div>
  )
}

type AppsFeed = { apps: AppUsage[]; members: MemberAppUsage[] }

export function ActivityAppsContent() {
  const { memberRole } = useAuth()
  const { isDark } = useTheme()
  const canExport = canExportActivity(memberRole)
  const canClassify = canClassifyActivity(memberRole)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const { day, searchQuery, selectedCategory, resetPageFilters, summarySlotEl } = useActivityShell()
  const { setSelectedMemberId, clearAllCache } = useActivityFeedContext()
  const { data: feed, loading, reload, classificationsUpdatedAt } = useActivityFeed<AppsFeed>("apps", { day: day.dayKey })
  // Summary is a standing overview, not a reflection of whatever single day
  // the table below happens to be drilled into - fetched independently
  // (day: "all") so it stays populated and stable instead of going empty on
  // a quiet day, or reshuffling every time the day picker moves.
  const { data: allTimeFeed, reload: reloadAllTime } = useActivityFeed<AppsFeed>("apps", { day: "all" })

  const appsSource = useMemo(
    () =>
      (feed?.apps ?? []).map((app) => ({
        ...app,
        name: formatActivityAppName(app.name),
        pattern: app.name,
        category: normalizeActivityCategory(app.category),
      })),
    [feed?.apps],
  )
  const membersSource = feed?.members ?? []
  // Every app ever seen, not just ones with activity on the currently
  // selected day - classification rules are patterns ("Slack" -> productive),
  // not day-scoped facts, so picking "today" shouldn't hide an app that was
  // last used last week from the list of things you can classify.
  const allTimeAppsSource = useMemo(
    () =>
      (allTimeFeed?.apps ?? []).map((app) => ({
        ...app,
        name: formatActivityAppName(app.name),
        pattern: app.name,
        category: normalizeActivityCategory(app.category),
      })),
    [allTimeFeed?.apps],
  )

  const categoryFiltered =
    selectedCategory === "all" ? appsSource : appsSource.filter((app) => app.category === selectedCategory)
  const searchLower = searchQuery.trim().toLowerCase()
  const filteredApps = useMemo(() => {
    const searched = searchLower
      ? categoryFiltered.filter(
          (app) =>
            app.name.toLowerCase().includes(searchLower) ||
            app.category.toLowerCase().includes(searchLower),
        )
      : categoryFiltered
    return searched
  }, [categoryFiltered, searchLower])
  const hasData = appsSource.length > 0 || membersSource.length > 0
  const tableRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, rowsPerPage } =
    usePaginatedTable(filteredApps, ACTIVITY_TABLE_ROWS_PER_PAGE)
  const {
    currentPage: memberPage,
    setCurrentPage: setMemberPage,
    totalPages: memberTotalPages,
    visibleRows: visibleMembers,
    rowsPerPage: memberRowsPerPage,
  } = usePaginatedTable(membersSource, ACTIVITY_TABLE_ROWS_PER_PAGE)
  const showDayEmpty = !loading && !hasData
  const showSearchEmpty = !loading && hasData && filteredApps.length === 0
  const showMainContent = !loading && hasData && !showSearchEmpty

  const summaryStats = useMemo(() => {
    const sessionCount = allTimeAppsSource.reduce((sum, app) => sum + app.sessions, 0)
    const productive = allTimeAppsSource.filter((a) => a.category === "productive").length
    const neutral = allTimeAppsSource.filter((a) => a.category === "neutral").length
    const unproductive = allTimeAppsSource.filter((a) => a.category === "distracting").length
    return { appCount: allTimeAppsSource.length, sessionCount, productive, neutral, unproductive }
  }, [allTimeAppsSource])

  const handleExport = useCallback(async () => {
    if (!canExport) return
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    
    const appsSheet = workbook.addWorksheet("Apps")
    appsSheet.columns = [
      { header: "App", key: "app", width: 20 },
      { header: "Category", key: "category", width: 15 },
      { header: "Total Time", key: "totalTime", width: 15 },
      { header: "Percentage", key: "percentage", width: 12 },
      { header: "Trend", key: "trend", width: 10 },
      { header: "Sessions", key: "sessions", width: 12 },
    ]
    
    const appRows = filteredApps.map((app) => ({
      app: app.name,
      category: app.category,
      totalTime: app.totalTime,
      percentage: `${app.percentage}%`,
      trend: app.trendValue,
      sessions: app.sessions,
    }))
    
    appRows.forEach(row => appsSheet.addRow(row))
    
    appsSheet.addRow({})
    appsSheet.addRow(["Period", day.selectedDayLabel])
    appsSheet.addRow(["Category Filter", selectedCategory])
    appsSheet.addRow(["Exported At", new Date().toLocaleString()])
    // Categories resolve at read time, so two exports of the same period
    // can differ. This says which classification state produced these rows.
    appsSheet.addRow(["Categories as of", classificationStamp(classificationsUpdatedAt)])
    
    const membersSheet = workbook.addWorksheet("Members")
    membersSheet.columns = [
      { header: "Member", key: "member", width: 20 },
      { header: "Top App", key: "topApp", width: 20 },
      { header: "Productive Time", key: "productiveTime", width: 15 },
      { header: "Productive %", key: "productivePercent", width: 15 },
      { header: "Neutral Time", key: "neutralTime", width: 15 },
      { header: "Unproductive Time", key: "unproductiveTime", width: 18 },
    ]
    
    const memberRows = membersSource.map((member) => ({
      member: member.member,
      topApp: member.topApp,
      productiveTime: member.productiveTime,
      productivePercent: `${member.productivePercent}%`,
      neutralTime: member.neutralTime,
      unproductiveTime: member.unproductiveTime,
    }))
    
    memberRows.forEach(row => membersSheet.addRow(row))
    
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `app-usage-${day.dayKey}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [canExport, classificationsUpdatedAt, day.dayKey, day.selectedDayLabel, filteredApps, membersSource, selectedCategory])

  const classifyItems = useMemo(
    () => allTimeAppsSource.map((app) => ({ pattern: app.pattern, label: app.name, category: app.category })),
    [allTimeAppsSource],
  )

  const handleClassify = useCallback(() => {
    setClassifyOpen(true)
  }, [])

  useActivityShellRegistration({
    onRefresh: () => {
      clearAllCache()
      void reload({ force: true })
      void reloadAllTime({ force: true })
    },
    onExport: canExport
      ? () => {
          void handleExport()
        }
      : undefined,
    onClassify: canClassify ? handleClassify : undefined,
  })

  return (
    <>
      {canClassify ? (
        <ClassificationDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          matchType="app"
          items={classifyItems}
          onSaved={() => {
            void reload({ force: true })
            void reloadAllTime({ force: true })
          }}
        />
      ) : null}

      {loading ? <ActivityLoadingState label="Loading app activity…" /> : null}

      {!loading && showDayEmpty ? (
        <ActivityDayEmptyState
          icon={Monitor}
          title="No app activity for this day"
          onShowAllDays={day.dayMode !== "all" ? day.setAllDays : undefined}
        />
      ) : null}

      {!loading && showSearchEmpty ? (
        <ActivitySearchEmptyState entityLabel="apps" onClear={resetPageFilters} />
      ) : null}

      {summarySlotEl && summaryStats.appCount > 0
        ? createPortal(
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl p-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80">
                  <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{summaryStats.productive}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">productive apps</p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
                className="flex items-center gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl p-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80">
                  <Minus className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{summaryStats.neutral}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{summaryStats.sessionCount} sessions tracked</p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="flex items-center gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl p-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-800/80">
                  <TrendingDown className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{summaryStats.unproductive}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{summaryStats.appCount} apps total</p>
                </div>
              </motion.div>
            </div>,
            summarySlotEl,
          )
        : null}

      {!loading && showMainContent ? (
        <div className="space-y-8">
          <ReclassificationNotice
            classificationsUpdatedAt={classificationsUpdatedAt}
            dayKey={day.dayKey}
          />
          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl"
            >
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50/80 dark:bg-slate-800/60">
                    <tr className="border-b border-slate-200/80 dark:border-slate-800">
                      {["Application", "Time", "Share", "Sessions", "Category"].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {visibleRows.map((app, index) => (
                      <motion.tr
                        key={app.id || `${app.name}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <AppIcon name={app.name} category={app.category} iconDataUrl={app.iconDataUrl} />
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{app.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{app.totalTime}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex min-w-[120px] items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className={cn("h-full rounded-full transition-all", getCategoryColor(app.category))}
                                style={{ width: `${app.percentage}%` }}
                              />
                            </div>
                            <span className="w-10 text-xs font-medium text-slate-500 dark:text-slate-400">{app.percentage}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300 font-medium">{app.sessions}</td>
                        <td className="px-5 py-4">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-tight",
                              getCategoryBgColor(app.category),
                            )}
                            title={
                              app.viaUrl
                                ? "A browser takes its category from the sites visited, not from the browser itself. This shows whichever category holds most of its time."
                                : undefined
                            }
                          >
                            {activityCategoryLabel(app.category)}
                            {app.viaUrl ? (
                              <span className="ml-1 font-normal opacity-70">· via sites</span>
                            ) : null}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              {filteredApps.length > 0 ? (
                <TablePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filteredApps.length}
                  rowsPerPage={rowsPerPage}
                  onPageChange={setCurrentPage}
                  isDark={isDark}
                />
              ) : null}
            </motion.div>
          </div>

          {membersSource.length > 0 ? (
            <ActivitySection title="Usage by member" description="Click a member to filter the table above by them">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl"
              >
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {visibleMembers.map((member, index) => (
                    <motion.button
                      key={member.memberId || `${member.member}-${index}`}
                      type="button"
                      onClick={() => member.memberId && setSelectedMemberId(member.memberId)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.03 + index * 0.03 }}
                      className="block w-full p-4 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center gap-4">
                        <ActivityMemberAvatar initials={member.avatar} imageUrl={member.avatarUrl} size="lg" />
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="font-medium text-slate-800 dark:text-slate-100">{member.member}</p>
                            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                              {member.productivePercent}% productive
                            </span>
                          </div>
                          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${member.productivePercent}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {member.productiveTime} tracked
                            </span>
                            <span>Top app: {member.topApp}</span>
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
                {membersSource.length > 0 ? (
                  <TablePagination
                    currentPage={memberPage}
                    totalPages={memberTotalPages}
                    totalItems={membersSource.length}
                    rowsPerPage={memberRowsPerPage}
                    onPageChange={setMemberPage}
                    isDark={isDark}
                  />
                ) : null}
              </motion.div>
            </ActivitySection>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

