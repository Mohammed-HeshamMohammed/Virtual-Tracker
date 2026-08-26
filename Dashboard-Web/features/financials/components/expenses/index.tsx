"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { useStandardReportLayout } from "@/features/reports"
import { useAuth } from "@/shared/providers/app"
import { isManagementRole } from "@/features/auth"
import { cn } from "@/shared/utils/utils"
import { AddExpenseModal } from "@/features/financials/components/expenses/add-expense-modal"
import {
  deleteExpense,
  listExpenses,
  reviewExpense,
  type Expense,
  type ExpenseStatus,
} from "@/features/expenses/api/expense-api"

type ExpenseTab = ExpenseStatus | "all"

const TABS: Array<{ key: ExpenseTab; label: string }> = [
  { key: "pending", label: "PENDING" },
  { key: "approved", label: "APPROVED" },
  { key: "rejected", label: "REJECTED" },
  { key: "all", label: "ALL" },
]

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

const STATUS_STYLE: Record<ExpenseStatus, string> = {
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-600",
}

/**
 * Expenses a member has claimed, and (for managers) the queue to review them.
 *
 * Statuses are the real ones the `expenses` table stores. The tabs used to be
 * uninvoiced/invoiced/paid over a hardcoded empty array - an invoicing model
 * that does not exist - so nothing here could ever have shown or saved data.
 */
export function ExpensesReportContent() {
  const { registerExportHandler } = useStandardReportLayout()
  const { memberId, memberRole } = useAuth()
  const canReview = isManagementRole(memberRole ?? "")

  const [tab, setTab] = useState<ExpenseTab>("pending")
  const [showModal, setShowModal] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listExpenses()
      .then(setExpenses)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load expenses."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const filtered = useMemo(
    () => (tab === "all" ? expenses : expenses.filter((e) => e.status === tab)),
    [expenses, tab]
  )

  const counts = useMemo(
    () => ({
      pending: expenses.filter((e) => e.status === "pending").length,
      approved: expenses.filter((e) => e.status === "approved").length,
      rejected: expenses.filter((e) => e.status === "rejected").length,
      all: expenses.length,
    }),
    [expenses]
  )

  const currency = expenses[0]?.currency ?? "USD"
  const mixedCurrency = new Set(expenses.map((e) => e.currency)).size > 1
  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  useEffect(() => {
    registerExportHandler(() => {
      const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`
      const headers = ["Member", "Date", "Description", "Amount", "Currency", "Category", "Project", "Billable", "Status"]
      const lines = [headers.join(",")]
      for (const e of filtered) {
        lines.push(
          [e.memberName, e.date, e.description, e.amount.toFixed(2), e.currency, e.category, e.projectName, e.billable ? "Yes" : "No", e.status]
            .map(esc)
            .join(",")
        )
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
    return () => registerExportHandler(null)
  }, [filtered, registerExportHandler])

  async function review(id: string, status: "approved" | "rejected") {
    setBusyId(id)
    setError(null)
    try {
      await reviewExpense(id, status)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to review expense.")
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await deleteExpense(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove expense.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              {t.label} ({counts[t.key]})
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Add expense
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Loading expenses…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {tab === "all" ? "No expenses yet." : `No ${tab} expenses.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed">
              <thead>
                <tr className="border-b border-slate-100">
                  {[
                    ["Member", "w-[16%] text-left"],
                    ["Date", "w-[11%] text-left"],
                    ["Description", "w-[21%] text-left"],
                    ["Category", "w-[10%] text-left"],
                    ["Project", "w-[13%] text-left"],
                    ["Amount", "w-[11%] text-right"],
                    ["Status", "w-[9%] text-center"],
                    ["", "w-[9%] text-right"],
                  ].map(([label, cls], i) => (
                    <th key={label || i} className={cn("px-4 py-3 text-sm font-semibold text-slate-700", cls)}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isOwn = e.memberId === memberId
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="truncate px-4 py-3 text-sm text-slate-800">{e.memberName}</td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-600">{e.date}</td>
                      <td className="truncate px-4 py-3 text-sm text-slate-600" title={e.description}>
                        {e.description}
                      </td>
                      <td className="px-4 py-3 text-sm capitalize text-slate-600">{e.category}</td>
                      <td className="truncate px-4 py-3 text-sm text-slate-600">{e.projectName || "—"}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800">
                        {money(e.amount, e.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                            STATUS_STYLE[e.status]
                          )}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* Reviewing your own claim is refused server-side too. */}
                        {canReview && e.status === "pending" && !isOwn ? (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === e.id}
                              onClick={() => void review(e.id, "approved")}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busyId === e.id}
                              onClick={() => void review(e.id, "rejected")}
                              className="text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          </span>
                        ) : isOwn && e.status !== "approved" ? (
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            onClick={() => void remove(e.id)}
                            className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-sm text-slate-900">
                    Total ({filtered.length})
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-900">
                    {mixedCurrency ? "—" : money(total, currency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddExpenseModal open={showModal} onClose={() => setShowModal(false)} onSaved={load} />
    </div>
  )
}
