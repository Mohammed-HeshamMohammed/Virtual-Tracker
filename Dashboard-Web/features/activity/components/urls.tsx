"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ActivityMemberAvatar } from "@/features/activity/components/activity-member-avatar"
import { useActivityFeed } from "@/features/activity/hooks/use-activity-feed"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { useActivityShell, useActivityShellRegistration } from "@/features/activity/components/activity-shell-context"
import { useAuth, useTheme } from "@/shared/providers/app"
import { canClassifyActivity, canExportActivity, canManageActivityData } from "@/features/auth"
import { motion } from "framer-motion"
import { Clock, Globe, ExternalLink, TrendingUp, TrendingDown, Eye } from "lucide-react"
import { cn } from "@/shared/utils/utils"
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

interface MemberUrlUsage {
  memberId?: string
  member: string
  avatar: string
  avatarUrl?: string | null
  productiveTime: string
  productivePercent: number
  neutralTime: string
  unproductiveTime: string
  topDomain: string
}

type UrlsFeed = { urls: URLUsage[]; members: MemberUrlUsage[] }

const getCategoryColor = activityCategoryColor
const getCategoryBadge = activityCategoryBadgeClass

/** Site names the agent reads from a window title that don't map to their own
 *  second-level domain. Just the common ones - everything else falls through
 *  to the "<first word>.com" guess. */
const KNOWN_SITE_HOSTS: Record<string, string> = {
  "google sheets": "sheets.google.com",
  "google docs": "docs.google.com",
  "google slides": "slides.google.com",
  "google drive": "drive.google.com",
  "google calendar": "calendar.google.com",
  "google meet": "meet.google.com",
  "google maps": "maps.google.com",
  "google photos": "photos.google.com",
  gmail: "mail.google.com",
  "microsoft teams": "teams.microsoft.com",
  "microsoft outlook": "outlook.com",
  outlook: "outlook.com",
  onedrive: "onedrive.live.com",
  "google chrome": "google.com",
}

/** Best-guess hostname for a row: the recorded domain if it's already one,
 *  a known product name, a bare one-word name resolved to "<name>.com"
 *  ("Zillow" -> "zillow.com"), or the brand's first word for a multi-word
 *  name ("Google Sheets" -> "google.com"). null only for a window-only row
 *  whose title has nothing host-shaped in it. */
function guessHost(domain: string, sourceKind?: "url" | "window"): string | null {
  const name = domain.trim().toLowerCase().replace(/^www\./, "")
  if (!name) return null
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return name
  if (KNOWN_SITE_HOSTS[name]) return KNOWN_SITE_HOSTS[name]
  if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) return `${name}.com`
  const firstWord = name.split(/[^a-z0-9]+/).find((w) => w.length >= 2)
  return firstWord ? `${firstWord}.com` : null
}

function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
}

/** Where the row's open-link button should go, or null when there's nothing
 *  sensible to open. A real captured URL wins; otherwise fall back to the
 *  guessed host. */
function openHrefFor(row: { url: string; domain: string; sourceKind?: "url" | "window" }): string | null {
  if (/^https?:\/\//i.test(row.url)) return row.url
  const host = guessHost(row.domain, row.sourceKind)
  return host ? `https://${host}` : null
}

/** The site's favicon, shown as-is (no tile). Falls back to a category-
 *  coloured square with a globe when there's no resolvable host or the
 *  favicon fails to load. */
function SiteFavicon({
  domain,
  category,
  sourceKind,
}: {
  domain: string
  category: ActivityCategory
  sourceKind?: "url" | "window"
}) {
  const [failed, setFailed] = useState(false)
  const host = guessHost(domain, sourceKind)

  if (host && !failed) {
    return (
      <img
        src={faviconUrl(host)}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-8 w-8 shrink-0 rounded-md object-contain"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white",
        getCategoryColor(category),
      )}
    >
      <Globe className="h-4 w-4" />
    </div>
  )
}

export function ActivityURLsContent() {
  const { memberRole } = useAuth()
  const { isDark } = useTheme()
  const canExport = canExportActivity(memberRole)
  const canManage = canManageActivityData(memberRole)
  const canClassify = canClassifyActivity(memberRole)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const { day, searchQuery, selectedCategory, showBlocked, resetPageFilters, summarySlotEl } = useActivityShell()
  const { setSelectedMemberId, clearAllCache } = useActivityFeedContext()
  const { data: feed, loading, reload, classificationsUpdatedAt } = useActivityFeed<UrlsFeed>("urls", { day: day.dayKey })
  const membersSource = feed?.members ?? []
  // Summary is a standing overview, not a reflection of whatever single day
  // the table below happens to be drilled into - fetched independently
  // (day: "all") so it stays populated and stable instead of going empty on
  // a quiet day, or reshuffling every time the day picker moves.
  const { data: allTimeFeed, reload: reloadAllTime } = useActivityFeed<UrlsFeed>("urls", { day: "all" })

  const urlsSource = useMemo(
    () => (feed?.urls ?? []).map((url) => ({ ...url, category: normalizeActivityCategory(url.category) })),
    [feed?.urls],
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
    return [...searched].sort((a, b) => b.visits - a.visits)
  }, [blockedFiltered, searchLower])
  const hasData = urlsSource.length > 0
  const tableRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, rowsPerPage } =
    usePaginatedTable(filteredURLs, ACTIVITY_TABLE_ROWS_PER_PAGE)
  const {
    currentPage: memberPage,
    setCurrentPage: setMemberPage,
    totalPages: memberTotalPages,
    visibleRows: visibleMembers,
    rowsPerPage: memberRowsPerPage,
  } = usePaginatedTable(membersSource, ACTIVITY_TABLE_ROWS_PER_PAGE)
  const showDayEmpty = !loading && !hasData
  const showSearchEmpty = !loading && hasData && filteredURLs.length === 0
  const showMainContent = !loading && hasData && !showSearchEmpty

  const allTimeUrls = useMemo(
    () => (allTimeFeed?.urls ?? []).map((url) => ({ ...url, category: normalizeActivityCategory(url.category) })),
    [allTimeFeed?.urls],
  )
  const totalVisits = allTimeUrls.reduce((acc, url) => acc + url.visits, 0)
  const urlCount = allTimeUrls.length
  const productiveCount = allTimeUrls.filter((u) => u.category === "productive").length
  const neutralCount = allTimeUrls.filter((u) => u.category === "neutral").length
  const blockedCount = allTimeUrls.filter((u) => u.category === "distracting").length

  const handleExport = useCallback(async () => {
    if (!canExport) return
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    
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
    
    urlsSheet.addRow({})
    urlsSheet.addRow(["Period", day.selectedDayLabel])
    urlsSheet.addRow(["Category Filter", selectedCategory])
    urlsSheet.addRow(["Exported At", new Date().toLocaleString()])
    // Categories resolve at read time, so two exports of the same period
    // can differ. This says which classification state produced these rows.
    urlsSheet.addRow(["Categories as of", classificationStamp(classificationsUpdatedAt)])
    
    const membersSheet = workbook.addWorksheet("Members")
    membersSheet.columns = [
      { header: "Member", key: "member", width: 20 },
      { header: "Productive %", key: "productivePercent", width: 15 },
      { header: "Productive Time", key: "productiveTime", width: 15 },
      { header: "Neutral Time", key: "neutralTime", width: 15 },
      { header: "Unproductive Time", key: "unproductiveTime", width: 18 },
      { header: "Top Domain", key: "topDomain", width: 25 },
    ]

    membersSource.forEach((member) => {
      membersSheet.addRow({
        member: member.member,
        productivePercent: `${member.productivePercent}%`,
        productiveTime: member.productiveTime,
        neutralTime: member.neutralTime,
        unproductiveTime: member.unproductiveTime,
        topDomain: member.topDomain,
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `url-usage-${day.dayKey}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [canExport, classificationsUpdatedAt, day.dayKey, day.selectedDayLabel, filteredURLs, membersSource, selectedCategory])

  // Every domain ever visited, not just ones with activity on the currently
  // selected day - classification rules are patterns ("reddit.com" ->
  // distracting), not day-scoped facts, so picking "today" shouldn't hide a
  // site that was last visited last week from the list of things you can
  // classify. Window-title rows (no URL) go in too, matched on the title text.
  const classifyItems = useMemo(
    () =>
      allTimeUrls.map((url) =>
        url.sourceKind === "window"
          ? { pattern: url.url, label: url.url, category: url.category, matchType: "window_title" as const }
          : { pattern: url.domain, label: url.domain, category: url.category },
      ),
    [allTimeUrls],
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
          matchType="domain"
          items={classifyItems}
          onSaved={() => {
            void reload({ force: true })
            void reloadAllTime({ force: true })
          }}
        />
      ) : null}

      {loading ? <ActivityLoadingState label="Loading URL activity…" /> : null}

      {!loading && showDayEmpty ? (
        <ActivityDayEmptyState
          icon={Globe}
          title="No URL activity for this day"
          description="URLs appear when the desktop agent reads the browser address bar, or from browser window titles when the address bar cannot be read. Keep the agent running with the timer active while browsing."
          onShowAllDays={day.dayMode !== "all" ? day.setAllDays : undefined}
        />
      ) : null}

      {!loading && showSearchEmpty ? (
        <ActivitySearchEmptyState entityLabel="URLs" onClear={resetPageFilters} />
      ) : null}

      {summarySlotEl && urlCount > 0
        ? createPortal(
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  key: "productive",
                  label: "Productive",
                  value: `${productiveCount}`,
                  icon: <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
                  iconBg: "bg-emerald-100 dark:bg-emerald-950/80",
                },
                {
                  key: "neutral",
                  label: "Neutral",
                  value: `${neutralCount}`,
                  icon: <Globe className="w-5 h-5 text-slate-600 dark:text-slate-300" />,
                  iconBg: "bg-slate-100 dark:bg-slate-800",
                },
                {
                  key: "blocked",
                  label: "Blocked",
                  value: `${blockedCount}`,
                  icon: <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />,
                  iconBg: "bg-red-100 dark:bg-red-950/80",
                },
                {
                  key: "sites",
                  label: "Sites / Visits",
                  value: `${urlCount} / ${totalVisits}`,
                  icon: <Eye className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
                  iconBg: "bg-blue-100 dark:bg-blue-950/80",
                },
              ].map((card, i) => (
                <motion.div
                  key={card.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5"
                >
                  <div className={cn("w-10 h-10 shrink-0 rounded-lg flex items-center justify-center", card.iconBg)}>
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500 dark:text-slate-400">{card.label}</p>
                    <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{card.value}</p>
                  </div>
                </motion.div>
              ))}
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
                            {url.sourceKind === "window" ? (
                              <div
                                className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white",
                                  getCategoryColor(url.category),
                                )}
                              >
                                <Globe className="h-4 w-4" />
                              </div>
                            ) : (
                              <SiteFavicon domain={url.domain} category={url.category} sourceKind={url.sourceKind} />
                            )}
                            <div className="min-w-0">
                              {url.sourceKind === "window" ? (
                                <>
                                  {/* No URL was readable - the window title is
                                      the identity, the browser is the context. */}
                                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100 max-w-[360px]">
                                    {url.url}
                                  </p>
                                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{url.domain}</p>
                                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                    Window title
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{url.domain}</p>
                                  <p className="truncate text-xs text-slate-500 dark:text-slate-400 max-w-[320px]">{url.url}</p>
                                </>
                              )}
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
                              {(() => {
                                const href = openHrefFor(url)
                                return href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Open ${href}`}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                                  </a>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-slate-600">—</span>
                                )
                              })()}
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
                className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
              >
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleMembers.map((member, index) => (
                    <motion.button
                      key={member.memberId || `${member.member}-${index}`}
                      type="button"
                      onClick={() => member.memberId && setSelectedMemberId(member.memberId)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.03 + index * 0.03 }}
                      className="block w-full p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
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
                            <div className="h-full bg-emerald-500" style={{ width: `${member.productivePercent}%` }} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {member.productiveTime} tracked
                            </span>
                            <span>Top site: {member.topDomain}</span>
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

