"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Ban, CheckCircle2, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { changedEvent } from "@/infrastructure/api/change-events"
import { useAuth, useTheme } from "@/shared/providers/app"
import { canViewParticipationMetrics } from "@/features/auth"
import {
  fetchReviewQueue,
  type ReviewQueueRow,
} from "@/features/tasks/api/task-assignments-api"
import { useReviewQueueMutations } from "@/features/timesheets/components/view-edit/hooks/use-review-queue-mutations"
import { SearchableSelectField } from "@/shared/ui/forms/searchable-select-field";
import { SelectField } from "@/shared/ui/forms/select-field";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  type Priority,
  type TaskStatus,
} from "@/features/tasks/constants/task-constants"
import { FilterBar, FilterField } from "@/features/timesheets/components/view-edit/components/FilterField"
import {
  ALL_FILTER,
  buildMemberFilterOptions,
  buildProjectFilterOptions,
  PRIORITY_FILTER_OPTIONS,
} from "@/features/timesheets/components/view-edit/components/filter-options"
import { formatMinutes } from "@/features/timesheets/components/view-edit/utils"
import {
  tableContainerEnter,
  rowTransition,
  emptyStateEnter,
  loadingPulse,
  buttonTap,
} from "@/features/timesheets/components/view-edit/lib/motion"
import { usePaginatedTable } from "@/shared/tables/hooks/use-paginated-table"
import { TablePagination } from "@/shared/tables/ui"

const REVIEW_QUEUE_ROWS_PER_PAGE = 10

function formatSeconds(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60))
  return formatMinutes(totalMinutes)
}

function formatEstimated(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—"
  return formatSeconds(seconds)
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function ParticipationCell({ row }: { row: ReviewQueueRow }) {
  const total = row.totalAssignees
  const started = row.startedAssignees
  if (total == null || total <= 1) return <span className="text-slate-400 dark:text-slate-500">—</span>

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col gap-0.5"
    >
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
        <Users className="h-3 w-3 text-slate-400 dark:text-slate-500" />
        {started ?? 0}/{total} started
      </span>
      {row.participationPercent != null ? (
        <span className="text-[10px] text-slate-500 dark:text-slate-400">{row.participationPercent}% participation</span>
      ) : null}
      {row.allAssigneesStarted ? (
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">All assignees started</span>
      ) : null}
    </motion.div>
  )
}

interface ReviewQueueTableProps {
  memberOptions: { id: string; name: string }[]
  projectOptions: { id: string; name: string }[]
  variant: "needs-review" | "priority-monitor"
  canReviewAssignments?: boolean
  myTeamOnly?: boolean
  teamMemberIds?: Set<string>
  teamMemberIdsLoading?: boolean
}

export function ReviewQueueTable({
  memberOptions,
  projectOptions,
  variant,
  canReviewAssignments = false,
  myTeamOnly = false,
  teamMemberIds,
  teamMemberIdsLoading = false,
}: ReviewQueueTableProps) {
  const { memberRole } = useAuth()
  const { isDark } = useTheme()
  const showParticipation = canViewParticipationMetrics(memberRole)
  const { submitReview } = useReviewQueueMutations({ canReviewAssignments })

  const [needsReview, setNeedsReview] = useState<ReviewQueueRow[]>([])
  const [priorityMonitor, setPriorityMonitor] = useState<ReviewQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState("")
  const [memberFilter, setMemberFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const loadRows = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchReviewQueue({
        projectId: projectFilter || undefined,
        memberId: memberFilter || undefined,
        priority: priorityFilter || undefined,
      })
      setNeedsReview(data.needsReview)
      setPriorityMonitor(data.priorityMonitor)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load review queue")
      setNeedsReview([])
      setPriorityMonitor([])
    } finally {
      setLoading(false)
    }
  }, [projectFilter, memberFilter, priorityFilter])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  // Live sync (PLAN-livesyncandagenttimer.md §6.4/case 7): this queue
  // previously never refreshed on its own - only a filter change re-ran
  // loadRows. Review-state transitions publish as "task-assignments"
  // changes on the backend (updateAssignmentPg), the same resource a
  // submission-for-review or a reviewer's decision both go through.
  useEffect(() => {
    const handler = () => void loadRows()
    window.addEventListener(changedEvent("task-assignments"), handler)
    return () => window.removeEventListener(changedEvent("task-assignments"), handler)
  }, [loadRows])

  const rows = variant === "needs-review" ? needsReview : priorityMonitor
  const scopedRows = useMemo(() => {
    if (!myTeamOnly || teamMemberIdsLoading || !teamMemberIds || teamMemberIds.size === 0) return rows
    return rows.filter((row) => teamMemberIds.has(row.userId))
  }, [rows, myTeamOnly, teamMemberIds, teamMemberIdsLoading])
  const { currentPage, setCurrentPage, totalPages, visibleRows, rowsPerPage } =
    usePaginatedTable(scopedRows, REVIEW_QUEUE_ROWS_PER_PAGE)
  const showFilters = variant === "needs-review"
  const showReviewColumn = variant === "needs-review" && canReviewAssignments
  const colSpan =
    (variant === "needs-review" ? (showReviewColumn ? 10 : 9) : 9) + (showParticipation ? 1 : 0)

  const handleReview = async (assignmentId: string, decision: "approve" | "reject") => {
    setReviewingId(assignmentId)
    try {
      const result = await submitReview(assignmentId, decision, reviewNotes[assignmentId] ?? "")
      setNeedsReview((prev) => prev.filter((r) => r.assignmentId !== assignmentId))
      setPriorityMonitor((prev) =>
        prev.map((r) =>
          r.assignmentId === assignmentId
            ? { ...r, assignmentStatus: result.assignmentStatus, taskStatus: result.taskStatus }
            : r,
        ),
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to review assignment")
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {loadError ? (
        <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-sm text-red-800 dark:text-red-300">
          {loadError}
        </div>
      ) : null}
      {showFilters ? (
        <FilterBar>
          <FilterField label="Project" index={0}>
            <SearchableSelectField
              value={projectFilter || ALL_FILTER}
              onChange={(value) => setProjectFilter(value === ALL_FILTER ? "" : value ?? "")}
              placeholder="All projects"
              menuMinWidth={240}
              visibleOptionRows={5}
              truncateOptions={false}
              options={buildProjectFilterOptions(projectOptions)}
            />
          </FilterField>
          <FilterField label="Employee" index={1}>
            <SearchableSelectField
              value={memberFilter || ALL_FILTER}
              onChange={(value) => setMemberFilter(value === ALL_FILTER ? "" : value ?? "")}
              placeholder="All employees"
              menuMinWidth={240}
              visibleOptionRows={5}
              truncateOptions={false}
              options={buildMemberFilterOptions(memberOptions)}
            />
          </FilterField>
          <FilterField label="Priority" className="sm:max-w-[180px]" index={2}>
            <SelectField
              value={priorityFilter || ALL_FILTER}
              onChange={(value) => setPriorityFilter(value === ALL_FILTER ? "" : value)}
              options={PRIORITY_FILTER_OPTIONS}
            />
          </FilterField>
          <motion.button
            type="button"
            {...buttonTap}
            onClick={() => void loadRows()}
            disabled={loading}
            className="inline-flex h-[38px] shrink-0 items-center rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80 disabled:opacity-60"
          >
            Refresh
          </motion.button>
        </FilterBar>
      ) : null}

      <motion.div
        {...tableContainerEnter}
        className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm backdrop-blur-xl"
      >
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3.5">Employee</th>
              <th className="px-4 py-3.5">Project</th>
              <th className="px-4 py-3.5">Task</th>
              <th className="px-4 py-3.5">Priority</th>
              <th className="px-4 py-3.5">Status</th>
              {showParticipation ? <th className="px-4 py-3.5">Participation</th> : null}
              <th className="px-4 py-3.5">Expected</th>
              <th className="px-4 py-3.5">Logged</th>
              <th className="px-4 py-3.5">Progress</th>
              <th className="px-4 py-3.5">Last activity</th>
              {showReviewColumn ? <th className="px-4 py-3.5">Review</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.tr
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <td colSpan={colSpan} className="px-4 py-8 text-center">
                    <motion.span {...loadingPulse} className="text-slate-400 dark:text-slate-500 font-medium">
                      Loading…
                    </motion.span>
                  </td>
                </motion.tr>
              ) : scopedRows.length === 0 ? (
                <motion.tr
                  key="empty"
                  {...emptyStateEnter}
                >
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 font-medium">
                    {variant === "needs-review"
                      ? "No assignments awaiting review."
                      : "No high-priority assignments to monitor."}
                  </td>
                </motion.tr>
              ) : (
                visibleRows.map((row, index) => {
                  const statusKey = row.assignmentStatus as TaskStatus
                  const statusCfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.todo
                  const priorityKey = (row.priority || "medium") as Priority
                  const priorityCfg = PRIORITY_CONFIG[priorityKey] ?? PRIORITY_CONFIG.medium
                  const isHighPriority = priorityKey === "high" || priorityKey === "urgent"

                  return (
                    <motion.tr
                      key={row.assignmentId}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12 }}
                      transition={rowTransition(index)}
                      layout
                      className={cn(
                        "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors",
                        variant === "priority-monitor" && isHighPriority && "bg-amber-50/40 dark:bg-amber-950/20",
                      )}
                    >
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-slate-100">{row.employeeName}</td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300 font-medium">{row.projectName || "—"}</td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-200 font-medium">{row.taskTitle}</td>
                      <td className="px-4 py-3">
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.15, delay: index * 0.02 }}
                          className={cn("inline-flex items-center gap-1.5 text-xs font-medium", priorityCfg.color)}
                        >
                          <span className={cn("h-2 w-2 rounded-full", priorityCfg.dot)} />
                          {priorityCfg.label}
                        </motion.span>
                      </td>
                      <td className="px-4 py-3">
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.15, delay: index * 0.02 + 0.03 }}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            statusCfg.bg,
                            statusCfg.color,
                          )}
                        >
                          {statusKey === "done" ? "Completed" : statusCfg.label}
                        </motion.span>
                      </td>
                      {showParticipation ? (
                        <td className="px-4 py-3">
                          <ParticipationCell row={row} />
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatEstimated(row.expectedSeconds)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatSeconds(row.loggedSeconds)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {row.progressPercent != null ? `${row.progressPercent}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(row.lastActivityAt)}</td>
                      {showReviewColumn ? (
                        <td className="px-4 py-3">
                          <div className="flex min-w-[220px] flex-col gap-2">
                            <input
                              type="text"
                              placeholder="Notes (optional)"
                              value={reviewNotes[row.assignmentId] ?? ""}
                              onChange={(e) =>
                                setReviewNotes((prev) => ({ ...prev, [row.assignmentId]: e.target.value }))
                              }
                              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1 text-xs transition-colors focus:border-emerald-300 dark:focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-200 dark:focus:ring-emerald-800"
                            />
                            <div className="flex gap-2">
                              <motion.button
                                type="button"
                                {...buttonTap}
                                disabled={reviewingId === row.assignmentId}
                                onClick={() => void handleReview(row.assignmentId, "approve")}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approve
                              </motion.button>
                              <motion.button
                                type="button"
                                {...buttonTap}
                                disabled={reviewingId === row.assignmentId}
                                onClick={() => void handleReview(row.assignmentId, "reject")}
                                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                <Ban className="h-3.5 w-3.5" />
                                Reject
                              </motion.button>
                            </div>
                          </div>
                        </td>
                      ) : null}
                    </motion.tr>
                  )
                })
              )}
            </AnimatePresence>
          </tbody>
        </table>
        {scopedRows.length > 0 ? (
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={scopedRows.length}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
            isDark={isDark}
            borderClassName={isDark ? "border-slate-800" : "border-slate-100"}
          />
        ) : null}
      </motion.div>
    </div>
  )
}
