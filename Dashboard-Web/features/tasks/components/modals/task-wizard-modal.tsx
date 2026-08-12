/* eslint-disable react-doctor/exhaustive-deps */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import React, { useCallback, useEffect, useState as useComponentState, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog"
import { SearchableSelectField } from "@/shared/ui/forms/searchable-select-field"
import { DatePickerField } from "@/shared/ui/forms/date-picker-field"
import { Toggle } from "@/shared/ui/forms/toggle"
import { cn } from "@/shared/utils/utils"
import { parseNonNegativeNumber, validateRequiredText } from "@/shared/validation"
import { buildScopedAssigneeOptions } from "@/features/tasks/utils/team-assignee-options"
import { fetchTaskParticipation } from "@/features/tasks/api/task-assignments-api"
import {
  type Task,
  type Member,
  type TaskStatus,
  type Priority,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  BOARD_COLUMNS,
} from "@/features/projects/constants"
import { useEntityLiveGuard } from "@/shared/hooks/use-entity-live-guard"

interface TaskWizardModalProps {
  open: boolean
  onClose: () => void
  onSave: (editingId: string | null, values: any) => Promise<void>
  isDark: boolean
  task: Task | null
  projectId: string
  projectTeams: any[]
  projectMembers: Member[]
  allMembers: Member[]
  allTeamsById: Record<string, string>
  initialStatus?: TaskStatus
  /** Live sync (§6.7) - the task was deleted by someone else while this
   * modal was open; parent shows a toast the same way projects-page.tsx
   * does for the project modal. */
  onEntityGone?: (message: string) => void
}

export function TaskWizardModal({
  open,
  onClose,
  onSave,
  isDark,
  task,
  projectId,
  projectTeams,
  projectMembers,
  allMembers,
  allTeamsById,
  initialStatus = "todo",
  onEntityGone,
}: TaskWizardModalProps) {
  const isEditingTask = task !== null
  const teamsLoading = false
  const teamsLoadError = null
  const [liveUpdateNotice, setLiveUpdateNotice] = useComponentState(false)
  const [staleSelectionNote, setStaleSelectionNote] = useComponentState<string | null>(null)

  const [newTaskTitle, setNewTaskTitle] = useComponentState("")
  const [newTaskDescription, setNewTaskDescription] = useComponentState("")
  const [newTaskStatus, setNewTaskStatus] = useComponentState<TaskStatus>(initialStatus)
  const [newTaskPriority, setNewTaskPriority] = useComponentState<Priority>("medium")
  const [newTaskTeamId, setNewTaskTeamId] = useComponentState<string | null>(null)
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useComponentState<string | null>(null)
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useComponentState<string[]>([])
  const [newTaskStartDate, setNewTaskStartDate] = useComponentState("")
  const [newTaskDueDate, setNewTaskDueDate] = useComponentState("")
  const [newTaskDurationHoursPerDay, setNewTaskDurationHoursPerDay] = useComponentState("")
  const [newTaskOvertimeHoursPerDay, setNewTaskOvertimeHoursPerDay] = useComponentState("")
  const [newTaskRollingHourCap, setNewTaskRollingHourCap] = useComponentState(false)
  const [newTaskSharedBudget, setNewTaskSharedBudget] = useComponentState(false)
  const [newTaskPosition, setNewTaskPosition] = useComponentState<"Top" | "Bottom">("Top")

  const [formAssigneeOptions, setFormAssigneeOptions] = useComponentState<{ value: string; label: string }[]>([])
  const [formAssigneesLoading, setFormAssigneesLoading] = useComponentState(false)
  const [editPreserveAssigneeIds, setEditPreserveAssigneeIds] = useComponentState<string[]>([])
  const [createTaskError, setCreateTaskError] = useComponentState<string | null>(null)
  const [isSavingTask, setIsSavingTask] = useComponentState(false)

  const [prevId, setPrevId] = useComponentState<string | null>(null)
  const [prevOpen, setPrevOpen] = useComponentState(false)

  const currentTaskId = task ? task.id : null

  // Live sync (§6.7): this modal doesn't own its own fetch (task arrives as
  // a prop from the already-cached Tasks list), so "reload" here means
  // closing the modal rather than re-fetching in place - reopening it picks
  // up whatever the parent's own live-synced list now has.
  const handleLiveDeleted = useCallback(() => {
    onClose()
    onEntityGone?.("This task was deleted by another user - your changes weren't saved.")
  }, [onClose, onEntityGone])
  const handleLiveUpdated = useCallback(() => {
    setLiveUpdateNotice(true)
  }, [])
  useEntityLiveGuard({
    resource: "tasks",
    id: currentTaskId,
    onDeleted: handleLiveDeleted,
    onUpdated: handleLiveUpdated,
  })

  useEffect(() => {
    if (!open) return
    if (open === prevOpen && currentTaskId === prevId) return

    setPrevOpen(open)
    setPrevId(currentTaskId)
    setCreateTaskError(null)
    setLiveUpdateNotice(false)
    setStaleSelectionNote(null)

    if (task) {
      setNewTaskTitle(task.title)
      setNewTaskDescription(task.description ?? "")
      setNewTaskStatus(task.status)
      setNewTaskPriority(task.priority)
      setNewTaskAssigneeId(null)
      setNewTaskAssigneeIds([])
      setEditPreserveAssigneeIds([])
      setNewTaskStartDate(task.startDate ? task.startDate.slice(0, 10) : "")
      setNewTaskDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "")
      setNewTaskTeamId(task.teamId)
      setNewTaskDurationHoursPerDay(task.durationHoursPerDay !== null ? String(task.durationHoursPerDay) : "")
      setNewTaskOvertimeHoursPerDay(task.overtimeHoursPerDay !== null ? String(task.overtimeHoursPerDay) : "")
      setNewTaskRollingHourCap(task.rollingHourCap === true)
      setNewTaskSharedBudget(task.sharedTaskBudget === true)

      let cancelled = false
      fetchTaskParticipation(task.id, { manage: true })
        .then((participation) => {
          if (cancelled || !participation?.assignments?.length) return
          const ids = participation.assignments.map((row) => row.userId).filter(Boolean)
          if (ids.length === 0) return
          setEditPreserveAssigneeIds(ids)
          setNewTaskAssigneeIds(ids)
          setNewTaskAssigneeId(ids[0] ?? null)
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }

    setNewTaskTitle("")
    setNewTaskDescription("")
    setNewTaskStatus(initialStatus)
    setNewTaskPriority("medium")
    setNewTaskAssigneeId(null)
    setNewTaskAssigneeIds([])
    setEditPreserveAssigneeIds([])
    setNewTaskStartDate("")
    setNewTaskDueDate("")
    setNewTaskTeamId(projectTeams.length === 1 ? projectTeams[0]!.id : null)
    setNewTaskDurationHoursPerDay("")
    setNewTaskOvertimeHoursPerDay("")
    setNewTaskRollingHourCap(false)
    setNewTaskSharedBudget(false)
    setNewTaskPosition("Top")
  }, [
    open,
    prevOpen,
    prevId,
    currentTaskId,
    task,
    initialStatus,
    projectTeams,
    setPrevOpen,
    setPrevId,
    setCreateTaskError,
    setNewTaskTitle,
    setNewTaskDescription,
    setNewTaskStatus,
    setNewTaskPriority,
    setNewTaskAssigneeId,
    setNewTaskAssigneeIds,
    setEditPreserveAssigneeIds,
    setNewTaskStartDate,
    setNewTaskDueDate,
    setNewTaskTeamId,
    setNewTaskDurationHoursPerDay,
    setNewTaskOvertimeHoursPerDay,
    setNewTaskPosition,
  ])

  useEffect(() => {
    if (open) return
    setPrevOpen(false)
    setPrevId(null)
    setEditPreserveAssigneeIds([])
  }, [open, setPrevOpen, setPrevId, setEditPreserveAssigneeIds])

  const memberLookups = useMemo(() => {
    const byId = new Map<string, Member>()
    for (const m of allMembers) byId.set(m.id, m)
    for (const m of projectMembers) byId.set(m.id, m)
    return [...byId.values()]
  }, [allMembers, projectMembers])

  const formTeamOptions = useMemo(() => {
    const resolveName = (teamId: string, fallback: string) => allTeamsById[teamId] ?? fallback
    const byId = new Map<string, any>()
    for (const team of projectTeams) byId.set(team.id, team)
    if (newTaskTeamId && !byId.has(newTaskTeamId)) {
      byId.set(newTaskTeamId, {
        id: newTaskTeamId,
        name: resolveName(newTaskTeamId, "Assigned team"),
      })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [projectTeams, newTaskTeamId, allTeamsById])

  // Build assignee options from the selected team only
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFormAssigneesLoading(true)

    buildScopedAssigneeOptions({
      teamId: newTaskTeamId,
      memberLookups,
      preserveMemberIds: isEditingTask ? editPreserveAssigneeIds : [],
    })
      .then((options) => {
        if (!cancelled) setFormAssigneeOptions(options)
      })
      .catch(() => {
        if (!cancelled) setFormAssigneeOptions([])
      })
      .finally(() => {
        if (!cancelled) setFormAssigneesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, newTaskTeamId, memberLookups, isEditingTask, editPreserveAssigneeIds])

  // §6.6/6.8 - after the assignee options refresh (live or otherwise), drop
  // any selection no longer among them (deleted mid-edit) instead of
  // silently letting a dead id reach the save payload.
  useEffect(() => {
    if (!open || formAssigneesLoading) return
    const validIds = new Set(formAssigneeOptions.map((opt) => opt.value))
    setNewTaskAssigneeIds((prev) => {
      const next = prev.filter((id) => validIds.has(id))
      if (next.length === prev.length) return prev
      setStaleSelectionNote(
        `${prev.length - next.length} selected ${prev.length - next.length === 1 ? "member was" : "members were"} removed and deselected.`,
      )
      setNewTaskAssigneeId(next[0] ?? null)
      return next
    })
  }, [open, formAssigneesLoading, formAssigneeOptions])

  async function handleSave() {
    if (isSavingTask) return
    const titleError = validateRequiredText(newTaskTitle, "Task title")
    if (titleError) {
      setCreateTaskError(titleError)
      return
    }
    if (formTeamOptions.length > 0 && !newTaskTeamId) {
      setCreateTaskError("Select a team")
      return
    }
    if (newTaskDurationHoursPerDay.trim() && parseNonNegativeNumber(newTaskDurationHoursPerDay) === null) {
      setCreateTaskError("Duration hours per day must be a valid number.")
      return
    }
    if (newTaskOvertimeHoursPerDay.trim() && parseNonNegativeNumber(newTaskOvertimeHoursPerDay) === null) {
      setCreateTaskError("Overtime hours per day must be a valid number.")
      return
    }

    setIsSavingTask(true)
    setCreateTaskError(null)

    // §6.8 - defense in depth: the reactive prune above already keeps
    // newTaskAssigneeIds in sync with formAssigneeOptions as it refreshes,
    // but a picker that never got a chance to refresh must still not be
    // able to submit an id the options already know is gone.
    const validAssigneeIds = new Set(formAssigneeOptions.map((opt) => opt.value))
    const sanitizedAssigneeIds = newTaskAssigneeIds.filter((id) => validAssigneeIds.has(id))

    try {
      await onSave(task ? task.id : null, {
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim(),
        teamId: newTaskTeamId,
        status: newTaskStatus,
        priority: newTaskPriority,
        assignedTo: sanitizedAssigneeIds[0] ?? newTaskAssigneeId,
        assigneeIds: sanitizedAssigneeIds,
        startDate: newTaskStartDate,
        dueDate: newTaskDueDate,
        durationHoursPerDay: newTaskDurationHoursPerDay,
        overtimeHoursPerDay: newTaskOvertimeHoursPerDay,
        rollingHourCap: newTaskRollingHourCap,
        sharedTaskBudget: newTaskSharedBudget,
        position: newTaskPosition,
        expectedUpdatedAt: task?.updatedAt,
      })
      onClose()
    } catch (error: any) {
      // §6.9 - a stale-write 409 gets the same non-blocking notice as a
      // live update arriving while the form was open, not a generic error.
      if (error?.status === 409) {
        setLiveUpdateNotice(true)
      } else {
        setCreateTaskError(error instanceof Error ? error.message : "Failed to save task")
      }
    } finally {
      setIsSavingTask(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90vh,720px)] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          isDark ? "bg-[#151b2d] border-[#2e3447] text-[#dce1fb]" : "",
        )}
      >
        <DialogHeader className="shrink-0 px-6 pb-2 pt-6">
          <DialogTitle className="text-lg font-semibold">
            {isEditingTask ? "Edit task" : "Create new task"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")} htmlFor="fallback-id">NAME</label>
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none",
                isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
              )} aria-label="Interactive control"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>DESCRIPTION</label>
            <textarea
              value={newTaskDescription}
              onChange={(e) => setNewTaskDescription(e.target.value)}
              rows={2}
              placeholder="Optional details…"
              className={cn(
                "w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none",
                isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
              )}
            />
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>
              TEAM {formTeamOptions.length > 0 ? <span className="text-red-500">*</span> : null}
            </label>
            {teamsLoading ? (
              <p className="text-sm text-slate-400">Loading teams…</p>
            ) : teamsLoadError ? (
              <p className="text-sm text-red-500">{teamsLoadError}</p>
            ) : formTeamOptions.length === 0 ? (
              <p className="text-sm text-slate-400">
                No teams linked.
              </p>
            ) : (
              <SearchableSelectField
                value={newTaskTeamId}
                onChange={(v) => {
                  setNewTaskTeamId(v)
                  setNewTaskAssigneeId(null)
                  setNewTaskAssigneeIds([])
                  setEditPreserveAssigneeIds([])
                  setCreateTaskError(null)
                }}
                placeholder="Select team"
                className="w-full"
                isDark={isDark}
                options={formTeamOptions.map((team) => ({ value: team.id, label: team.name }))}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>LIST</label>
            <SearchableSelectField
              value={newTaskStatus}
              onChange={(v) => {
                if (v !== null) setNewTaskStatus(v as TaskStatus)
              }}
              placeholder="Select list"
              className="w-full"
              isDark={isDark}
              options={BOARD_COLUMNS.filter((col) => col !== "in_review" || newTaskStatus === "in_review").map((col) => ({
                value: col,
                label: STATUS_CONFIG[col].label,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>PRIORITY</label>
            <SearchableSelectField
              value={newTaskPriority}
              onChange={(v) => {
                if (v !== null) setNewTaskPriority(v as Priority)
              }}
              placeholder="Select priority"
              className="w-full"
              isDark={isDark}
              options={(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => ({
                value: p,
                label: PRIORITY_CONFIG[p].label,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>
              DURATION HOURLY / DAY
            </label>
            <input
              type="number"
              min={0}
              step={0.25}
              value={newTaskDurationHoursPerDay}
              onChange={(e) => setNewTaskDurationHoursPerDay(e.target.value)}
              placeholder="e.g. 8"
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none",
                isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
              )}
            />
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>
              OVERTIME HOURLY PER DAY
            </label>
            <input
              type="number"
              min={0}
              step={0.25}
              value={newTaskOvertimeHoursPerDay}
              onChange={(e) => setNewTaskOvertimeHoursPerDay(e.target.value)}
              placeholder="e.g. 2"
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none",
                isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
              )}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2 border-slate-200 dark:border-[#2e3447]">
            <div className="space-y-0.5">
              <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                Continuous session cap
              </p>
              <p className={cn("text-xs text-slate-500", isDark && "text-slate-400")}>
                Count the daily-hour limit against one continuous clock-in-to-clock-out session instead of
                resetting at midnight - for shifts that cross into the next calendar day.
              </p>
            </div>
            <Toggle checked={newTaskRollingHourCap} onChange={setNewTaskRollingHourCap} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2 border-slate-200 dark:border-[#2e3447]">
            <div className="space-y-0.5">
              <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
                Shared team budget
              </p>
              <p className={cn("text-xs text-slate-500", isDark && "text-slate-400")}>
                Split this task's total hours as one pool shared by every assignee combined, instead of each
                assignee getting their own full allotment independently.
              </p>
            </div>
            <Toggle checked={newTaskSharedBudget} onChange={setNewTaskSharedBudget} />
          </div>
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>START DATE</label>
            <DatePickerField
              value={newTaskStartDate}
              onChange={setNewTaskStartDate}
              placeholder="Select date"
            />
          </div>
          <div className={cn("space-y-1.5", isEditingTask && "sm:col-span-2")}>
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>DUE DATE</label>
            <DatePickerField
              value={newTaskDueDate}
              onChange={setNewTaskDueDate}
              placeholder="Select date"
            />
          </div>
          {!isEditingTask ? (
            <div className="space-y-1.5">
              <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>POSITION</label>
              <SearchableSelectField
                value={newTaskPosition}
                onChange={(v) => {
                  if (v !== null) setNewTaskPosition(v as "Top" | "Bottom")
                }}
                placeholder="Select position"
                className="w-full"
                isDark={isDark}
                options={[
                  { value: "Top", label: "Top" },
                  { value: "Bottom", label: "Bottom" },
                ]}
              />
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>
              ASSIGNEES
            </label>
            {formTeamOptions.length > 0 && !newTaskTeamId ? (
              <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                Select a team first.
              </p>
            ) : formAssigneesLoading ? (
              <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>Loading members…</p>
            ) : (
              <div
                className={cn(
                  "max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2",
                  isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
                )}
              >
                {formAssigneeOptions.length === 0 ? (
                  <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>No members available.</p>
                ) : (
                  formAssigneeOptions.map((opt) => {
                    const checked = newTaskAssigneeIds.includes(opt.value)
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                          isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? newTaskAssigneeIds.filter((id) => id !== opt.value)
                              : [...newTaskAssigneeIds, opt.value]
                            setNewTaskAssigneeIds(next)
                            setNewTaskAssigneeId(next[0] ?? null)
                          }}
                          className="rounded border-slate-300"
                        />
                        <span>{opt.label}</span>
                      </label>
                    )
                  })
                )}
              </div>
            )}
          </div>
          </div>
          {staleSelectionNote ? (
            <div
              className={cn(
                "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
                isDark
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              <span>{staleSelectionNote}</span>
              <button
                type="button"
                onClick={() => setStaleSelectionNote(null)}
                className="shrink-0 text-sm font-medium underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {liveUpdateNotice ? (
            <div
              className={cn(
                "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
                isDark
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              <span>Someone else changed this task while you had it open.</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLiveUpdateNotice(false)}
                  className="text-sm font-medium underline underline-offset-2"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    "rounded-md px-2 py-1 text-sm font-medium",
                    isDark ? "bg-amber-500/20" : "bg-amber-100",
                  )}
                >
                  Close &amp; reopen
                </button>
              </div>
            </div>
          ) : null}
          {createTaskError ? <p className="mt-3 text-sm text-red-500">{createTaskError}</p> : null}
        </div>
        <DialogFooter
          className={cn(
            "shrink-0 gap-2 border-t px-6 py-4",
            isDark ? "border-[#2e3447]" : "border-slate-100",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            className={cn("px-6 py-2.5 rounded-lg text-sm font-medium border transition-colors", isDark ? "border-[#2e3447] hover:bg-[#2e3447]" : "border-slate-200 hover:bg-slate-50")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!newTaskTitle.trim() || (formTeamOptions.length > 0 && !newTaskTeamId) || isSavingTask}
            className={cn("px-6 py-2.5 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50", isDark ? "bg-[#4be277] hover:bg-[#4be277]/90 text-black" : "bg-blue-400 hover:bg-blue-500")}
          >
            {isSavingTask ? (isEditingTask ? "Saving…" : "Creating…") : isEditingTask ? "Save" : "Create"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
