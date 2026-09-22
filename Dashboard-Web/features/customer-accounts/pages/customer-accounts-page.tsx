"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Building2, RefreshCw, ShieldOff, Users } from "lucide-react"
import { NotifyToastHost } from "@/shared/ui/layout"
import type { NotifyAlertTone } from "@/shared/ui/alert-notify"
import {
  listCustomerAccounts,
  getRemovalPreview,
  removeCustomerAccount,
  renewCustomerAccountPeriod,
  changeCustomerAccountSeats,
  requestUnlockCode,
  verifyUnlockCode,
  UnlockError,
} from "@/features/customer-accounts/api/customer-accounts-api"
import type { CustomerAccountSummary, RemovalPreview } from "@/features/customer-accounts/models/customer-account"

const inputCls =
  "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

function fmtDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return "—"
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/**
 * US-5 / §16.8: a copy of the ordinary members page's shape (email, role,
 * seats used/limit, period end, status; renew/seats/remove as the only
 * actions), not a byte-for-byte reuse of it - the columns are fundamentally
 * different data (tenants, not members), so the shared table
 * infrastructure members-page.tsx builds on does not apply here. Every
 * mutating action on this page still goes through its own unlock step
 * (§16.3) - opening this page is not the same as having verified.
 */
export function CustomerAccountsPage() {
  const [rows, setRows] = useState<CustomerAccountSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; title: string; tone: NotifyAlertTone } | null>(null)
  const [unlockToken, setUnlockToken] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockCode, setUnlockCode] = useState("")
  const [unlockStage, setUnlockStage] = useState<"idle" | "code">("idle")
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{ kind: "renew" | "seats" | "remove"; row: CustomerAccountSummary } | null>(null)
  const [awaitingUnlockFor, setAwaitingUnlockFor] = useState<{ kind: "renew" | "seats" | "remove"; row: CustomerAccountSummary } | null>(null)
  const [removalPreview, setRemovalPreview] = useState<RemovalPreview | null>(null)
  const [confirmEmail, setConfirmEmail] = useState("")
  const [formValue, setFormValue] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listCustomerAccounts()
      .then(setRows)
      .catch((e) => setToast({ title: "Customer accounts", tone: "error", message: e instanceof Error ? e.message : "Could not load customer accounts." }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAction(kind: "renew" | "seats" | "remove", row: CustomerAccountSummary) {
    setPendingAction({ kind, row })
    setFormValue(kind === "renew" ? row.periodEnd.slice(0, 10) : kind === "seats" ? String(row.seatLimit) : "")
    setConfirmEmail("")
    setRemovalPreview(null)
    if (kind === "remove") {
      getRemovalPreview(row.id)
        .then(setRemovalPreview)
        .catch((e) => setToast({ title: "Customer accounts", tone: "error", message: e instanceof Error ? e.message : "Could not load removal preview." }))
    }
  }

  async function handleVerifyUnlock() {
    if (unlocking || unlockCode.trim().length !== 6) return
    setUnlocking(true)
    setUnlockError(null)
    try {
      const token = await verifyUnlockCode(unlockCode.trim())
      setUnlockToken(token)
      setUnlockStage("idle")
      setUnlockCode("")
      // Same click the Owner already made resumes automatically - they
      // should not have to click "Renew"/"Seats"/"Remove" a second time
      // just because verification happened to land in between.
      if (awaitingUnlockFor) {
        openAction(awaitingUnlockFor.kind, awaitingUnlockFor.row)
        setAwaitingUnlockFor(null)
      }
    } catch (e) {
      setUnlockError(e instanceof UnlockError || e instanceof Error ? e.message : "Verification failed.")
    } finally {
      setUnlocking(false)
    }
  }

  async function startAction(kind: "renew" | "seats" | "remove", row: CustomerAccountSummary) {
    if (unlockToken) {
      openAction(kind, row)
      return
    }
    setAwaitingUnlockFor({ kind, row })
    setUnlockStage("code")
    setUnlockError(null)
    try {
      await requestUnlockCode()
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : "Could not send a verification code.")
    }
  }

  async function submitPendingAction() {
    if (!pendingAction || !unlockToken || busy) return
    setBusy(true)
    try {
      if (pendingAction.kind === "renew") {
        const iso = new Date(`${formValue}T23:59:59`).toISOString()
        await renewCustomerAccountPeriod(pendingAction.row.id, iso, unlockToken)
        setToast({ title: "Customer accounts", tone: "info", message: `Renewed through ${fmtDate(iso)}.` })
      } else if (pendingAction.kind === "seats") {
        await changeCustomerAccountSeats(pendingAction.row.id, Number(formValue), unlockToken)
        setToast({ title: "Customer accounts", tone: "info", message: `Seat limit set to ${formValue}.` })
      } else {
        await removeCustomerAccount(pendingAction.row.id, confirmEmail, unlockToken)
        setToast({ title: "Customer accounts", tone: "info", message: "Account removed. Access ended immediately." })
      }
      setPendingAction(null)
      load()
    } catch (e) {
      setToast({ title: "Customer accounts", tone: "error", message: e instanceof Error ? e.message : "Action failed." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <NotifyToastHost message={toast?.message ?? null} onDismiss={() => setToast(null)} title={toast?.title ?? "Customer accounts"} tone={toast?.tone ?? "error"} />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Building2 className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Customer accounts</h1>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {unlockStage === "code" ? (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">
            Enter the verification code sent to your email to renew, change seats, or remove an account.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={unlockCode}
              onChange={(e) => setUnlockCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && void handleVerifyUnlock()}
              placeholder="000000"
              className={`${inputCls} max-w-32 text-center tracking-[0.3em]`}
            />
            <button
              type="button"
              onClick={() => void handleVerifyUnlock()}
              disabled={unlocking || unlockCode.length !== 6}
              className="rounded-lg bg-blue-500 dark:bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {unlocking ? "Verifying…" : "Verify"}
            </button>
          </div>
          {unlockError ? <p className="mt-2 text-xs text-red-500">{unlockError}</p> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-100 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Seats</th>
              <th className="px-4 py-2.5">Period end</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : !rows || rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <Users className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  No customer accounts yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-2.5 font-medium">{row.email}</td>
                  <td className="px-4 py-2.5">{row.grantedRole}</td>
                  <td className="px-4 py-2.5">
                    {row.seatsUsed} / {row.seatLimit}
                  </td>
                  <td className="px-4 py-2.5">{fmtDate(row.periodEnd)}</td>
                  <td className="px-4 py-2.5">
                    {row.lifecycle === "removing" ? (
                      <span className="inline-flex items-center gap-1 text-slate-400"><ShieldOff className="h-3 w-3" /> Removing</span>
                    ) : row.active ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Expired</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-3 text-[11px] font-medium">
                      <button type="button" onClick={() => void startAction("renew", row)} className="text-blue-500 dark:text-emerald-400 hover:underline">
                        Renew
                      </button>
                      <button type="button" onClick={() => void startAction("seats", row)} className="text-blue-500 dark:text-emerald-400 hover:underline">
                        Seats
                      </button>
                      <button type="button" onClick={() => void startAction("remove", row)} className="text-red-500 hover:underline">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pendingAction && unlockToken ? (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-6" onClick={() => setPendingAction(null)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">
              {pendingAction.kind === "renew" ? "Renew paid period" : pendingAction.kind === "seats" ? "Change seat limit" : "Remove customer account"}
            </h2>

            {pendingAction.kind === "renew" ? (
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">NEW PERIOD END</label>
                <input type="date" value={formValue} onChange={(e) => setFormValue(e.target.value)} className={inputCls} />
              </div>
            ) : pendingAction.kind === "seats" ? (
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">SEAT LIMIT</label>
                <input type="number" min={1} step={1} value={formValue} onChange={(e) => setFormValue(e.target.value)} className={inputCls} />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  This permanently deletes {pendingAction.row.email}, everyone under them, and all their data. This cannot be undone.
                </p>
                {removalPreview ? (
                  <ul className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-[11px] text-slate-500 dark:text-slate-400">
                    <li>{removalPreview.members} member(s)</li>
                    <li>{removalPreview.pendingInvites} pending invite(s)</li>
                    <li>{removalPreview.projects} project(s)</li>
                    <li>{removalPreview.tasks} task(s)</li>
                    <li>{removalPreview.timeEntries} time entr{removalPreview.timeEntries === 1 ? "y" : "ies"}</li>
                    <li>{removalPreview.screenshots} screenshot(s)</li>
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-400">Loading counts…</p>
                )}
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    TYPE {pendingAction.row.email} TO CONFIRM
                  </label>
                  <input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingAction(null)} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitPendingAction()}
                disabled={busy || (pendingAction.kind === "remove" && confirmEmail.trim().toLowerCase() !== pendingAction.row.email.toLowerCase())}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                  pendingAction.kind === "remove" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 dark:bg-emerald-600 hover:bg-blue-600 dark:hover:bg-emerald-500"
                }`}
              >
                {busy ? "Working…" : pendingAction.kind === "remove" ? "Remove permanently" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
