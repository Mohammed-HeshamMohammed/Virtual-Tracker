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
import { getProjects } from "@/features/projects/api/project-api"
import { getTasks } from "@/features/tasks/api/task-api"
import { createTimeEntry } from "@/features/timesheets/api/timesheet-api"
import { parseHoursInput } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { useAuth } from "@/shared/providers/app"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"

/** Today as YYYY-MM-DD in local time (not UTC, which shifts the day). */
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

/**
 * Backfills time for someone else - a manager filling in for a member who
 * forgot to start the timer, without asking that member to do it themself.
 * Same write path features/timesheets/.../ManualTimeContent.tsx already uses
 * for self-service manual time (time_entries, source='manual'); the backend's
 * assertTimeEntryWriteAuthorized (schema/routes.js) is what actually makes
 * "for someone else" possible - it already allows a management-role viewer
 * to write a time entry for any member in their access scope, this dialog is
 * just the first UI that hands it a memberId other than the viewer's own.
 */
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

  const [members, setMembers] = useState<{ id: string; name: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [memberSearch, setMemberSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [taskId, setTaskId] = useState("")
  const [date, setDate] = useState(todayLocal)
  const [hours, setHours] = useState("")
  const [description, setDescription] = useState("")
  const [billable, setBillable] = useState(true)

  const durationSeconds = useMemo(() => parseHoursInput(hours), [hours])

  // Reset to a blank form each time the dialog opens, and load the member +
  // project rosters fresh - stale options from a previous open would let
  // someone submit against a project or member no longer valid.
  useEffect(() => {
    if (!open) return
    setError(null)
    setMemberSearch("")
    setSelectedMemberId("")
    setProjectId("")
    setTaskId("")
    setDate(todayLocal())
    setHours("")
    setDescription("")
    setBillable(true)
    setTasks([])

    let cancelled = false
    setLoadingOptions(true)
    Promise.all([
      getMembers({ fields: ["id", "name"], singlePage: true, limit: 500 }),
      getProjects({ fields: ["id", "name", "status"] }),
    ])
      .then(([memberRows, projectRows]) => {
        if (cancelled) return
        setMembers(
          memberRows
            .map((m) => ({ id: String(m.id), name: m.name || "Unnamed" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setProjects(
          projectRows
            .filter((p) => String(p.status ?? "").toLowerCase() !== "archived")
            .map((p) => ({ id: String(p.id), name: String(p.name ?? "Untitled project") }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
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

  // Tasks are per-project - re-fetched (and the picked task cleared) every
  // time the project changes, so a stale task from a different project can
  // never be submitted alongside a newly picked one.
  useEffect(() => {
    setTaskId("")
    if (!projectId) {
      setTasks([])
      return
    }
    let cancelled = false
    setLoadingTasks(true)
    getTasks({ projectId })
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
  }, [projectId])

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.name.toLowerCase().includes(q))
  }, [members, memberSearch])

  const selectedMember = members.find((m) => m.id === selectedMemberId)

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
            <label htmlFor="ame-member" className={labelCls}>
              Member
            </label>
            {selectedMember ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100">
                <span>{selectedMember.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedMemberId("")}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  id="ame-member"
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={loadingOptions ? "Loading members…" : "Search members…"}
                  disabled={loadingOptions}
                  className={inputCls}
                />
                {memberSearch.trim() ? (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    {filteredMembers.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-400">No members match.</p>
                    ) : (
                      filteredMembers.slice(0, 20).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedMemberId(m.id)
                            setMemberSearch("")
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          {m.name}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}
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
              <span className={labelCls}>
                To-do <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <ReportSimpleDropdown
                value={taskId}
                onChange={setTaskId}
                options={tasks.map((t) => ({ value: t.id, label: t.title }))}
                placeholder={!projectId ? "Pick a project first" : loadingTasks ? "Loading to-dos…" : "Whole project (no to-do)"}
                disabled={!projectId || loadingTasks}
                width="w-full"
                accentBar={false}
              />
            </div>
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
