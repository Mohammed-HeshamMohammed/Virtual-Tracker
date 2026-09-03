"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { getMembers } from "@/features/members/api/member-api"
import {
  getProjectMembers,
  getProjects,
  getTrackableProjects,
  type TrackableProject,
} from "@/features/projects/api/project-api"
import { projectTypeDef } from "@/features/projects/config/project-types"
import { getTasks } from "@/features/tasks/api/task-api"
import { createTimeEntry } from "@/features/timesheets/api/timesheet-api"
import { parseHoursInput } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { useAuth, useTheme } from "@/shared/providers/app"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { SearchableSelectField, type SearchableSelectOption } from "@/shared/ui/forms/searchable-select-field"
import { initialsFromName } from "@/features/members/utils/build-tree"

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, "0")}`
}

const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-hidden focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500"
const labelCls = "mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"

export function AddManualEntryDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const { memberId: viewerMemberId } = useAuth()
  const { isDark } = useTheme()

  const [members, setMembers] = useState<{ id: string; name: string; avatarUrl?: string | null }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; type: string }[]>([])
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([])
  const [projectMemberIds, setProjectMemberIds] = useState<Set<string> | null>(null)
  // Projects the viewer themself can clock in on - used only to decide
  // whether "Myself" belongs in the Member list for whatever project is
  // currently selected (a viewer can see/manage a project without being a
  // trackable member of it, e.g. a manager not personally assigned to it).
  const [viewerTrackableProjectIds, setViewerTrackableProjectIds] = useState<Set<string>>(new Set())
  const [targetProjectRules, setTargetProjectRules] = useState<Map<string, TrackableProject>>(new Map())
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingProjectMembers, setLoadingProjectMembers] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [taskId, setTaskId] = useState("")
  const [date, setDate] = useState(todayLocal)
  const [hours, setHours] = useState("")
  const [description, setDescription] = useState("")
  const [billable, setBillable] = useState(true)

  const durationSeconds = useMemo(() => parseHoursInput(hours), [hours])

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelectedMemberId("")
    setProjectId("")
    setTaskId("")
    setDate(todayLocal())
    setHours("")
    setDescription("")
    setBillable(true)
    setTasks([])
    setProjectMemberIds(null)

    let cancelled = false
    setLoadingOptions(true)
    Promise.all([
      getMembers({ fields: ["id", "name", "avatarUrl"], singlePage: true, limit: 500 }),
      getProjects({ fields: ["id", "name", "type", "status"] }),
      getTrackableProjects().catch(() => []),
    ])
      .then(([memberRows, projectRows, trackableRows]) => {
        if (cancelled) return
        setMembers(
          memberRows
            .map((m) => ({ id: String(m.id), name: m.name || "Unnamed", avatarUrl: m.avatarUrl }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setProjects(
          projectRows
            .filter((p) => String(p.status ?? "").toLowerCase() !== "archived")
            .map((p) => ({ id: String(p.id), name: String(p.name ?? "Untitled project"), type: String(p.type ?? "") }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setViewerTrackableProjectIds(new Set(trackableRows.map((p) => p.id)))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load members and projects.")
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Scoped to the member the time is for, not the whole project's board -
  // the server refuses a to-do that isn't theirs (see taskIsAssignedToMember),
  // so anyone else's would only be a dead end. Waits for a member to be
  // picked, since until then there is no-one to scope to.
  useEffect(() => {
    setTaskId("")
    if (!projectId || !selectedMemberId) {
      setTasks([])
      return
    }
    let cancelled = false
    setLoadingTasks(true)
    getTasks({ projectId, assignedTo: selectedMemberId })
      .then((rows) => {
        if (!cancelled) setTasks(rows.map((t) => ({ id: t.id, title: t.title || "Untitled task" })))
      })
      .catch(() => {
        if (!cancelled) setTasks([])
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, selectedMemberId])

  // Whether this project needs a to-do naming *for this member* - the same
  // server-resolved rule the Manual time form uses, looked up rather than
  // re-derived, since the escapes depend on their role (org admin tier, a
  // client on a client_can_track project) not just the project's settings.
  useEffect(() => {
    if (!selectedMemberId) {
      setTargetProjectRules(new Map())
      return
    }
    let cancelled = false
    getTrackableProjects(selectedMemberId)
      .then((rows) => {
        if (!cancelled) setTargetProjectRules(new Map(rows.map((p) => [p.id, p])))
      })
      .catch(() => {
        if (!cancelled) setTargetProjectRules(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [selectedMemberId])

  useEffect(() => {
    if (!projectId) {
      setProjectMemberIds(null)
      return
    }
    let cancelled = false
    setLoadingProjectMembers(true)
    getProjectMembers(projectId)
      .then((rows) => {
        if (cancelled) return
        const ids = new Set(rows.map((r) => r.memberId))
        setProjectMemberIds(ids)
        setSelectedMemberId((current) => (current && !ids.has(current) ? "" : current))
      })
      .catch(() => {
        if (!cancelled) setProjectMemberIds(new Set())
      })
      .finally(() => {
        if (!cancelled) setLoadingProjectMembers(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // hasTasks comes off the project type either way; taskRequired only the
  // server can answer, so before a member is chosen (no rule fetched yet)
  // it stays false and the field reads as optional.
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId])
  const selectedProjectRule = projectId ? (targetProjectRules.get(projectId) ?? null) : null
  const projectHasTasks = selectedProject ? projectTypeDef(selectedProject.type).hasTasks : false
  const taskRequired = Boolean(selectedProjectRule?.taskRequired)

  const projectMembers = useMemo(
    () => (projectMemberIds ? members.filter((m) => projectMemberIds.has(m.id)) : []),
    [members, projectMemberIds],
  )

  // "Myself" is a convenience shortcut, not a second listing of the viewer's
  // own name - excluded from the regular roster below whenever it's shown.
  const viewerCanTrackSelectedProject = Boolean(projectId) && viewerTrackableProjectIds.has(projectId)

  const memberOptions = useMemo<SearchableSelectOption[]>(() => {
    const roster = projectMembers.filter((m) => m.id !== viewerMemberId)
    const options = roster.map((m) => ({
      value: m.id,
      label: m.name,
      meta: <ReportMemberAvatar initials={initialsFromName(m.name)} imageUrl={m.avatarUrl} />,
    }))
    if (viewerCanTrackSelectedProject && viewerMemberId) {
      const viewerAvatarUrl = members.find((m) => m.id === viewerMemberId)?.avatarUrl
      options.unshift({
        value: viewerMemberId,
        label: "Myself",
        meta: <ReportMemberAvatar initials="Me" imageUrl={viewerAvatarUrl} />,
      })
    }
    return options
  }, [members, projectMembers, viewerCanTrackSelectedProject, viewerMemberId])

  async function submit() {
    setError(null)
    if (!selectedMemberId) {
      setError("Pick who this time is for.")
      return
    }
    if (!projectId) {
      setError("Pick a project for this time.")
      return
    }
    if (taskRequired && !taskId) {
      setError("This project tracks time against to-dos - pick the one this time was for.")
      return
    }
    if (durationSeconds <= 0) {
      setError("Enter how long they worked, e.g. 1:30, 1.5 or 90m.")
      return
    }
    if (!description.trim()) {
      setError("Add a short reason - manual time is reviewed by a manager.")
      return
    }
    setSaving(true)
    try {
      await createTimeEntry(
        {
          memberId: selectedMemberId,
          projectId,
          taskId: taskId || undefined,
          date,
          startTime: "",
          endTime: "",
          duration: durationSeconds,
          description: description.trim(),
          billable,
        },
        viewerMemberId ?? undefined,
      )
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this time entry.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add time for someone</DialogTitle>
          <DialogDescription>
            Backfill time a team member forgot to track - for the project or to-do they were actually working on.
            It's logged as manual time and goes through the same review as time they'd add themselves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <span className={labelCls}>Project</span>
            <ReportSimpleDropdown
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select a project"
              disabled={loadingOptions}
              width="w-full"
              accentBar={false}
            />
          </div>

          <div>
            <label className={labelCls}>Member</label>
            <SearchableSelectField
              value={selectedMemberId || null}
              onChange={(v) => setSelectedMemberId(v ?? "")}
              options={memberOptions}
              placeholder={
                !projectId
                  ? "Pick a project first"
                  : loadingProjectMembers
                    ? "Loading this project's members…"
                    : memberOptions.length === 0
                      ? "No members on this project"
                      : "Select a member"
              }
              isDark={isDark}
              className={!projectId || loadingProjectMembers ? "pointer-events-none opacity-60" : undefined}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ame-date" className={labelCls}>
                Date
              </label>
              <input
                id="ame-date"
                type="date"
                value={date}
                max={todayLocal()}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ame-hours" className={labelCls}>
                Time worked
              </label>
              <input
                id="ame-hours"
                type="text"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="1:30, 1.5 or 90m"
                className={inputCls}
              />
              {hours && durationSeconds > 0 ? (
                <p className="mt-1 text-xs text-slate-400">= {formatSeconds(durationSeconds)}</p>
              ) : null}
            </div>
            {projectHasTasks ? (
              <div>
                <span className={labelCls}>
                  To-do {taskRequired ? null : <span className="font-normal text-slate-400">(optional)</span>}
                </span>
                <ReportSimpleDropdown
                  value={taskId}
                  onChange={setTaskId}
                  options={tasks.map((t) => ({ value: t.id, label: t.title }))}
                  placeholder={
                    !projectId
                      ? "Pick a project first"
                      : !selectedMemberId
                        ? "Pick a member first"
                        : loadingTasks
                          ? "Loading to-dos…"
                          : tasks.length === 0
                            ? "No to-dos assigned to them here"
                            : taskRequired
                              ? "Select a to-do"
                              : "Whole project (no to-do)"
                  }
                  disabled={!projectId || !selectedMemberId || loadingTasks}
                  width="w-full"
                  accentBar={false}
                />
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="ame-reason" className={labelCls}>
              Reason
            </label>
            <input
              id="ame-reason"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why wasn't this tracked live?"
              className={inputCls}
            />
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">Billable</span>
          </label>

          {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || loadingOptions}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-blue-600"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Add time
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
