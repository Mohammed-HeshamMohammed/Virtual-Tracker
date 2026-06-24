"use client"

import { useCallback, useMemo } from "react"
import { useActivityFeed } from "@/features/activity/hooks/use-activity-feed"
import { useActivityShell, useActivityShellRegistration } from "@/features/activity/components/activity-shell-context"
import { useAuth } from "@/shared/providers/app"
import { canExportActivity } from "@/features/auth"
import { motion } from "framer-motion"
import { Clock, Monitor, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { formatActivityAppName } from "@/features/activity/utils/display-names"
import {
  ActivityDayEmptyState,
  ActivityLoadingState,
  ActivitySearchEmptyState,
} from "@/features/activity/components/activity-page-states"
import { ActivitySection } from "@/features/activity/components/activity-section"

interface AppUsage {
  id: string
  name: string
  category: "productive" | "neutral" | "unproductive"
  totalTime: string
  percentage: number
  trend: "up" | "down" | "neutral"
  trendValue: string
  sessions: number
}

interface MemberAppUsage {
  memberId?: string
  member: string
  avatar: string
  productiveTime: string
  productivePercent: number
  neutralTime: string
  unproductiveTime: string
  topApp: string
}

const getCategoryColor = (category: string) => {
  if (category === "productive") return "bg-emerald-500"
  if (category === "neutral") return "bg-slate-400"
  return "bg-red-500"
}

const getCategoryBgColor = (category: string) => {
  if (category === "productive") return "bg-emerald-100 text-emerald-700"
  if (category === "neutral") return "bg-slate-100 text-slate-700"
  return "bg-red-100 text-red-700"
}

type AppsFeed = { apps: AppUsage[]; members: MemberAppUsage[] }

export function ActivityAppsContent() {
  const { memberRole } = useAuth()
  const canExport = canExportActivity(memberRole)
  const { day, searchQuery, selectedCategory, sortOrder } = useActivityShell()
  const { data: feed, loading, reload } = useActivityFeed<AppsFeed>("apps", { day: day.dayKey })

  const appsSource = useMemo(
    () =>
      (feed?.apps ?? []).map((app) => ({
        ...app,
        name: formatActivityAppName(app.name),
      })),
    [feed?.apps],
  )
  const membersSource = feed?.members ?? []

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
    if (sortOrder === "name") {
      return [...searched].sort((a, b) => a.name.localeCompare(b.name))
    }
    return searched
  }, [categoryFiltered, searchLower, sortOrder])
  const hasData = appsSource.length > 0 || membersSource.length > 0
  const showDayEmpty = !loading && !hasData
  const showSearchEmpty = !loading && hasData && filteredApps.length === 0
  const showMainContent = !loading && hasData && !showSearchEmpty

  const summaryStats = useMemo(() => {
    const sessionCount = appsSource.reduce((sum, app) => sum + app.sessions, 0)
    const productive = appsSource.filter((a) => a.category === "productive").length
    const neutral = appsSource.filter((a) => a.category === "neutral").length
    const unproductive = appsSource.filter((a) => a.category === "unproductive").length
    return { appCount: appsSource.length, sessionCount, productive, neutral, unproductive }
  }, [appsSource])

  const handleExport = useCallback(async () => {
    if (!canExport) return
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    
    // Apps sheet
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
    
    // Add metadata to apps sheet
    appsSheet.addRow({})
    appsSheet.addRow(["Period", day.selectedDayLabel])
    appsSheet.addRow(["Category Filter", selectedCategory])
    appsSheet.addRow(["Exported At", new Date().toLocaleString()])
    
    // Members sheet
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
  }, [canExport, day.dayKey, day.selectedDayLabel, filteredApps, membersSource, selectedCategory])

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
      {loading ? <ActivityLoadingState label="Loading app activity…" /> : null}

      {!loading && showDayEmpty ? (
        <ActivityDayEmptyState icon={Monitor} title="No app activity for this day" />
      ) : null}

      {!loading && showSearchEmpty ? (
        <ActivitySearchEmptyState entityLabel="apps" />
      ) : null}

      {!loading && showMainContent ? (
        <div className="space-y-8">
          <ActivitySection
            title="Application records"
            description={`${filteredApps.length} app${filteredApps.length !== 1 ? "s" : ""} tracked for ${day.selectedDayLabel}`}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-x-auto rounded-xl border border-slate-100 bg-white shadow-sm"
            >
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50">
                    <tr className="border-b border-slate-100">
                      {["Application", "Time", "Share", "Sessions", "Category"].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApps.map((app, index) => (
                      <motion.tr
                        key={app.id || `${app.name}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.02 + index * 0.02 }}
                        className="hover:bg-slate-50/80"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white",
                                getCategoryColor(app.category),
                              )}
                            >
                              {app.name.charAt(0)}
                            </div>
                            <span className="font-medium text-slate-800">{app.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold text-slate-700">{app.totalTime}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex min-w-[120px] items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn("h-full rounded-full", getCategoryColor(app.category))}
                                style={{ width: `${app.percentage}%` }}
                              />
                            </div>
                            <span className="w-10 text-xs text-slate-500">{app.percentage}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">{app.sessions}</td>
                        <td className="px-5 py-4">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                              getCategoryBgColor(app.category),
                            )}
                          >
                            {app.category}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
            </motion.div>
          </ActivitySection>

          <ActivitySection title="Summary" description="Productivity breakdown for the selected day">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 gap-4 md:grid-cols-3"
            >
              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Productive</p>
                    <p className="mt-1 text-2xl font-bold text-slate-800">{summaryStats.productive}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                    <TrendingUp className="h-6 w-6 text-emerald-600" />
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-500">productive apps</p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Neutral</p>
                    <p className="mt-1 text-2xl font-bold text-slate-800">{summaryStats.neutral}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                    <Minus className="h-6 w-6 text-slate-600" />
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-500">{summaryStats.sessionCount} sessions tracked</p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Unproductive</p>
                    <p className="mt-1 text-2xl font-bold text-slate-800">{summaryStats.unproductive}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
                    <TrendingDown className="h-6 w-6 text-red-600" />
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-500">{summaryStats.appCount} apps total</p>
              </div>
            </motion.div>
          </ActivitySection>

          {membersSource.length > 0 ? (
            <ActivitySection title="Usage by member" description="Per-member app breakdown">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm"
              >
                <div className="divide-y divide-slate-100">
                  {membersSource.map((member, index) => (
                    <motion.div
                      key={member.memberId || `${member.member}-${index}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.03 + index * 0.03 }}
                      className="p-4 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-slate-200 to-slate-300 text-sm font-semibold text-slate-600">
                          {member.avatar}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="font-medium text-slate-800">{member.member}</p>
                            <span className="text-sm font-semibold text-emerald-600">
                              {member.productivePercent}% productive
                            </span>
                          </div>
                          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${member.productivePercent}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {member.productiveTime} tracked
                            </span>
                            <span>Top app: {member.topApp}</span>
                          </div>
                        </div>
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

