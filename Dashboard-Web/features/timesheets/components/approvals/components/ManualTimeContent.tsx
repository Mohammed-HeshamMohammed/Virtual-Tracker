"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/shared/utils/utils"
import { useAuth, useTheme } from "@/shared/providers/app"
import { isManagementRole } from "@/features/auth"
import { getMembers } from "@/features/members/api/member-api"
import { initialsFromName } from "@/features/members/utils/build-tree"
import { getTrackableProjects } from "@/features/projects/api/project-api"
import { createTimeEntry, deleteTimeEntry, getTimeEntries, type TimeEntry } from "@/features/timesheets/api/timesheet-api"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { SearchableSelectField, type SearchableSelectOption } from "@/shared/ui/forms/searchable-select-field"

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function parseHoursInput(raw: string): number {
  const value = raw.trim().toLowerCase()
  if (!value) return 0
  const hhmm = /^(\d{1,3}):([0-5]?\d)$/.exec(value)
  if (hhmm) return Number(hhmm[1]) * 3600 + Number(hhmm[2]) * 60
  const minutes = /^(\d+(?:\.\d+)?)\s*m$/.exec(value)
  if (minutes) return Math.round(Number(minutes[1]) * 60)
  const hours = /^(\d+(?:\.\d+)?)\s*h?$/.exec(value)
  if (hours) return Math.round(Number(hours[1]) * 3600)
  return 0
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, "0")}`
}

const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"

export function ManualTimeContent() {
  const { memberId, memberRole } = useAuth()
  const { isDark } = useTheme()
  const likelyInstant = isManagementRole(memberRole)
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Who this entry is for - managers+ can pick a teammate instead of
  // themselves (folded in from the old separate "Add time for someone"
  // dialog); everyone else only ever submits for themselves.
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [date, setDate] = useState(todayLocal)
  const [projectId, setProjectId] = useState("")
  const [hours, setHours] = useState("")
  const [description, setDescription] = useState("")
  const [billable, setBillable] = useState(true)

  const durationSeconds = useMemo(() => parseHoursInput(hours), [hours])
  const targetMemberId = selectedMemberId || memberId || ""
  const targetIsSelf = targetMemberId === memberId

  // Defaults to "myself" the moment auth resolves - only overridden if the
  // viewer explicitly picks someone else from the Member dropdown below.
  useEffect(() => {
    if (memberId && !selectedMemberId) setSelectedMemberId(memberId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  useEffect(() => {
    if (!likelyInstant || !memberId) return
    let cancelled = false
    getMembers({ fields: ["id", "name"], singlePage: true, limit: 500 })
      .then((rows) => {
        if (cancelled) return
        setTeamMembers(
          rows
            .map((m) => ({ id: String(m.id), name: m.name || "Unnamed" }))
            .filter((m) => m.id !== memberId)
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      })
      .catch(() => setTeamMembers([]))
    return () => {
      cancelled = true
    }
  }, [likelyInstant, memberId])

  // "Myself" (memberId) sits first, then whoever this manager can see/manage
  // (already server-scoped by getMembers - see getVisibleMemberIds), each
  // with an avatar for quick scanning.
  const memberOptions = useMemo<SearchableSelectOption[]>(() => {
    if (!memberId) return []
    const options: SearchableSelectOption[] = [
      { value: memberId, label: "Myself", meta: <ReportMemberAvatar initials="Me" /> },
    ]
    for (const m of teamMembers) {
      options.push({ value: m.id, label: m.name, meta: <ReportMemberAvatar initials={initialsFromName(m.name)} /> })
    }
    return options
  }, [memberId, teamMembers])

  const loadEntries = useCallback(() => {
    if (!memberId) return
    setLoading(true)
    getTimeEntries({ memberId })
      .then((rows) => setEntries(rows.filter((r) => r.memberId === memberId)))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [memberId])

  // The Project list is scoped to whoever this entry is currently for, not
  // the viewer - a manager backfilling for a teammate needs that teammate's
  // own trackable projects (see listTrackableProjectIdsPg), which can
  // differ from the manager's own.
  useEffect(() => {
    if (!targetMemberId) return
    let cancelled = false
    setLoadingProjects(true)
    getTrackableProjects(targetIsSelf ? undefined : targetMemberId)
      .then((rows) => {
        if (cancelled) return
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
        setProjects(sorted)
        setProjectId((current) => (current && !sorted.some((p) => p.id === current) ? "" : current))
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [targetMemberId, targetIsSelf])

  useEffect(loadEntries, [loadEntries])

  async function submit() {
    if (!memberId || !targetMemberId) return
    setError(null)
    setNotice(null)
    if (!projectId) {
      setError("Pick a project for this time.")
      return
    }
    if (durationSeconds <= 0) {
      setError("Enter how long you worked, e.g. 1:30, 1.5 or 90m.")
      return
    }
    if (!description.trim()) {
      setError("Add a short reason - manual time is reviewed by a manager.")
      return
    }
    setSaving(true)
    try {
      const created = await createTimeEntry(
        {
          memberId: targetMemberId,
          projectId,
          date,
          startTime: "",
          endTime: "",
          duration: durationSeconds,
          description: description.trim(),
          billable,
        },
        memberId
      )
      setHours("")
      setDescription("")
      setNotice(created.status === "approved" ? "Manual time added." : "Request submitted — awaiting approval.")
      loadEntries()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add manual time.")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await deleteTimeEntry(id)
      loadEntries()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that entry.")
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
          {likelyInstant ? "Manual time" : "Request manual time"}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {likelyInstant
            ? "Add time that wasn't tracked live, for yourself or a teammate. It lands approved right away and appears in the Manual time edits report."
            : "Time you worked but did not track. This is a request - a manager reviews it before it counts towards your timesheet."}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {likelyInstant ? (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Member</label>
            <SearchableSelectField
              value={selectedMemberId || null}
              onChange={(v) => setSelectedMemberId(v ?? memberId ?? "")}
              options={memberOptions}
              placeholder="Select a member"
              isDark={isDark}
            />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mt-date" className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Date
            </label>
            <input
              id="mt-date"
              type="date"
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label
              htmlFor="mt-project"
              className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Project
            </label>
            <select
              id="mt-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={loadingProjects}
              className={inputCls}
            >
              <option value="">{loadingProjects ? "Loading projects…" : "Select a project"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mt-hours" className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Time worked
            </label>
            <input
              id="mt-hours"
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
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">Billable</span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="mt-reason"
              className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Reason
            </label>
            <input
              id="mt-reason"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why was this time not tracked?"
              className={inputCls}
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-emerald-600">{notice}</p> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !memberId}
          className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : likelyInstant ? "Add manual time" : "Submit request"}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Your manual entries</h3>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">You have not added any manual time yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-24 shrink-0 text-sm text-slate-500">{e.date}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                  {e.description || "No reason given"}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-slate-700 dark:text-slate-200">
                  {formatSeconds(e.duration)}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                    e.status === "approved"
                      ? "bg-emerald-50 text-emerald-600"
                      : e.status === "rejected"
                        ? "bg-red-50 text-red-600"
                        : "bg-amber-50 text-amber-600"
                  )}
                >
                  {e.status}
                </span>
                {e.status !== "approved" ? (
                  <button
                    type="button"
                    onClick={() => void remove(e.id)}
                    className="shrink-0 text-xs font-medium text-red-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
