"use client"

import { useEffect, useState } from "react"
import {
  approveTimeEntry,
  rejectTimeEntry,
  getTimeEntries,
  type TimeEntry,
} from "@/features/timesheets/api/timesheet-api"
import { useAuth } from "@/shared/providers/app"
import { changedEvent } from "@/infrastructure/api/change-events"
import { ReportToolbarMultiSelect, useReportFilterOptions } from "@/features/reports/components/shared/report-filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { initialsFromName } from "@/features/members/utils/build-tree"

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, "0")}`
}

export function PendingManualTimeQueue({
  members,
}: {
  members: { id: string; name: string; avatarUrl?: string | null }[]
}) {
  const { memberId } = useAuth()
  const [pending, setPending] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(() => new Set())
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(() => new Set())
  const { projects } = useReportFilterOptions()
  const visible = pending.filter((entry) =>
    (selectedMembers.size === 0 || selectedMembers.has(entry.memberId)) &&
    (selectedProjects.size === 0 || selectedProjects.has(entry.projectId)))

  function load() {
    setLoading(true)
    getTimeEntries({ status: "pending" })
      .then((rows) => setPending(rows))
      .catch(() => setPending([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [])

  const nameById = new Map(members.map((m) => [m.id, m.name]))

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id)
    setError(null)
    try {
      if (action === "approve") await approveTimeEntry(id, memberId ?? undefined)
      else await rejectTimeEntry(id, memberId ?? undefined)
      setPending((rows) => rows.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update this request.")
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <p className="text-center text-sm text-slate-400">Loading pending manual time…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Pending requests {pending.length > 0 ? `(${pending.length})` : ""}
      </h2>
      <div className="flex flex-wrap gap-3">
        <ReportToolbarMultiSelect label="Members" emptyLabel="All members" options={members} selected={selectedMembers} onChange={setSelectedMembers} />
        <ReportToolbarMultiSelect label="Projects" emptyLabel="All projects" options={projects} selected={selectedProjects} onChange={setSelectedProjects} />
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          {pending.length === 0 ? "No manual time requests waiting for review." : "No requests match these filters."}
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {visible.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <ReportMemberAvatar initials={initialsFromName(nameById.get(entry.memberId) ?? "Unknown member")} imageUrl={members.find((m) => m.id === entry.memberId)?.avatarUrl} />
                <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {nameById.get(entry.memberId) ?? "Unknown member"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {entry.date} · {formatSeconds(entry.duration)}
                  {entry.description ? ` · ${entry.description}` : ""}
                </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void act(entry.id, "reject")}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void act(entry.id, "approve")}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busyId === entry.id ? "…" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
