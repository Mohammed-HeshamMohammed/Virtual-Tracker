"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { useAuth } from "@/shared/providers/app"
import { isManagementRole } from "@/features/auth"
import { cn } from "@/shared/utils/utils"
import {
  createTimeOffPolicy,
  createTimeOffRequest,
  listTimeOffPolicies,
  listTimeOffRequests,
  reviewTimeOffRequest,
  type TimeOffPolicy,
  type TimeOffRequest,
  type TimeOffRequestStatus,
} from "@/features/time-off/api/time-off-api"

type Tab = TimeOffRequestStatus | "all"

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "PENDING" },
  { key: "approved", label: "APPROVED" },
  { key: "rejected", label: "REJECTED" },
  { key: "all", label: "ALL" },
]

const STATUS_STYLE: Record<TimeOffRequestStatus, string> = {
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-600",
  cancelled: "bg-slate-100 text-slate-500",
  pending: "bg-amber-50 text-amber-600",
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"

export function TimeOffRequestsPage(_props: { onNavigate?: (id: string) => void } = {}) {
  const { memberId, memberRole } = useAuth()
  const canReview = isManagementRole(memberRole ?? "")

  const [policies, setPolicies] = useState<TimeOffPolicy[]>([])
  const [requests, setRequests] = useState<TimeOffRequest[]>([])
  const [tab, setTab] = useState<Tab>("pending")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [policyId, setPolicyId] = useState("")
  const [startDate, setStartDate] = useState(todayLocal)
  const [endDate, setEndDate] = useState(todayLocal)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  const [newPolicyName, setNewPolicyName] = useState("")
  const [newPolicyDays, setNewPolicyDays] = useState("20")
  const [showPolicyForm, setShowPolicyForm] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([listTimeOffPolicies(), listTimeOffRequests()])
      .then(([p, r]) => {
        setPolicies(p)
        setRequests(r)
        setPolicyId((current) => current || (p[0]?.id ?? ""))
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load time off."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const filtered = useMemo(
    () => (tab === "all" ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  )

  async function submitRequest() {
    if (!policyId) {
      setError("Pick a time off policy first.")
      return
    }
    if (endDate < startDate) {
      setError("The end date cannot be before the start date.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createTimeOffRequest({ policyId, startDate, endDate, note: note.trim() })
      setNote("")
      setShowForm(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit request.")
    } finally {
      setSaving(false)
    }
  }

  async function act(id: string, status: "approved" | "rejected" | "cancelled") {
    setBusyId(id)
    setError(null)
    try {
      await reviewTimeOffRequest(id, status)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update request.")
    } finally {
      setBusyId(null)
    }
  }

  async function addPolicy() {
    const days = Number(newPolicyDays)
    if (!newPolicyName.trim() || !Number.isFinite(days) || days < 0) {
      setError("Give the policy a name and a valid number of days.")
      return
    }
    setError(null)
    try {
      await createTimeOffPolicy({ name: newPolicyName.trim(), daysPerYear: days })
      setNewPolicyName("")
      setShowPolicyForm(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create policy.")
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Time off</h1>
          <p className="mt-1 text-sm text-slate-500">
            Request time off and track what has been approved. Approved days are deducted from the member&apos;s
            balance.
          </p>
        </div>
        <div className="flex gap-2">
          {canReview ? (
            <button
              type="button"
              onClick={() => setShowPolicyForm((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Policies
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={policies.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Request time off
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {policies.length === 0 && !loading ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No time off policies exist yet.{" "}
          {canReview ? "Create one to let people request time off." : "Ask an administrator to create one."}
        </p>
      ) : null}

      {showPolicyForm && canReview ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">New policy</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="text"
              value={newPolicyName}
              onChange={(e) => setNewPolicyName(e.target.value)}
              placeholder="e.g. Annual leave"
              aria-label="Policy name"
              className={cn(inputCls, "sm:col-span-2")}
            />
            <input
              type="number"
              min="0"
              value={newPolicyDays}
              onChange={(e) => setNewPolicyDays(e.target.value)}
              placeholder="Days per year"
              aria-label="Days per year"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => void addPolicy()}
            className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
          >
            Create policy
          </button>
        </div>
      ) : null}

      {showForm && policies.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">New request</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="to-policy" className="mb-1 block text-xs font-semibold text-slate-500">
                Policy
              </label>
              <select id="to-policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)} className={inputCls}>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="to-start" className="mb-1 block text-xs font-semibold text-slate-500">
                From
              </label>
              <input
                id="to-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="to-end" className="mb-1 block text-xs font-semibold text-slate-500">
                To
              </label>
              <input
                id="to-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="to-note" className="mb-1 block text-xs font-semibold text-slate-500">
                Note
              </label>
              <input
                id="to-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void submitRequest()}
            disabled={saving}
            className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit request"}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors",
              tab === t.key ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {t.label} ({t.key === "all" ? requests.length : requests.filter((r) => r.status === t.key).length})
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const isOwn = r.member_id === memberId
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-800">{r.member_name}</span>
                  <span className="shrink-0 text-sm text-slate-500">
                    {r.start_date} → {r.end_date}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-slate-700">{r.days}d</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{r.policy_name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                      STATUS_STYLE[r.status]
                    )}
                  >
                    {r.status}
                  </span>
                  {r.status === "pending" ? (
                    <span className="flex shrink-0 gap-2">
                      {canReview && !isOwn ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void act(r.id, "approved")}
                            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void act(r.id, "rejected")}
                            className="text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {isOwn ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void act(r.id, "cancelled")}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
