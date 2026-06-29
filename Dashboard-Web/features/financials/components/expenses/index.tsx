/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useStandardReportLayout } from "@/features/reports"
import { cn } from "@/shared/utils/utils"
import { StatusBadge, Avatar, ReceiptIllustration } from "@/features/financials/components/shared/ui-components"
import { AddExpenseModal } from "@/features/financials/components/expenses/add-expense-modal"

type ExpenseTab = "uninvoiced" | "invoiced" | "paid" | "all"

interface Expense {
  id: string
  member: string
  memberAvatar: string
  memberColor: string
  date: string
  description: string
  amount: number
  category: string
  project: string
  status: ExpenseTab
  billable: boolean
  receipt?: string
}

const TABS: Array<{ key: ExpenseTab; label: string }> = [
  { key: "uninvoiced", label: "UNINVOICED" },
  { key: "invoiced", label: "INVOICED" },
  { key: "paid", label: "PAID" },
  { key: "all", label: "ALL" },
]

export function ExpensesReportContent() {
  const { registerExportHandler } = useStandardReportLayout()
  const [tab, setTab] = useState<ExpenseTab>("uninvoiced")
  const [showModal, setShowModal] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>([])

  const filtered = useMemo(
    () => (tab === "all" ? expenses : expenses.filter((e) => e.status === tab)),
    [expenses, tab]
  )

  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  const counts = useMemo(
    () => ({
      uninvoiced: expenses.filter((e) => e.status === "uninvoiced").length,
      invoiced: expenses.filter((e) => e.status === "invoiced").length,
      paid: expenses.filter((e) => e.status === "paid").length,
      all: expenses.length,
    }),
    [expenses]
  )

  const handleExportCsv = useCallback(() => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const headers = ["Member", "Date", "Description", "Amount", "Category", "Project", "Status"]
    const lines = [headers.join(",")]
    for (const e of filtered) {
      lines.push(
        [
          esc(e.member),
          esc(e.date),
          esc(e.description),
          esc(String(e.amount)),
          esc(e.category),
          esc(e.project),
          esc(e.status),
        ].join(",")
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `expenses-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, tab])

  useEffect(() => {
    registerExportHandler(() => handleExportCsv())
    return () => registerExportHandler(null)
  }, [handleExportCsv, registerExportHandler])

  function addExpense(e: Omit<Expense, "id" | "status">) {
    const newExpense = { ...e, id: `e${Date.now()}`, status: tab === "all" ? "uninvoiced" : tab }
    setExpenses((prev) => [...prev, newExpense])
  }

  return (
    <>
      <div className="max-w-[1300px] mx-auto space-y-5">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap",
                tab === t.key ? "border-blue-500 text-blue-500" : "border-transparent text-slate-400 hover:text-slate-600"
              )} type="button"
            >
              {t.label} ({counts[t.key]})
            </button>
          ))}
        </div>

        {/* Total + Add */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">TOTAL (TAB)</div>
            <div className="text-2xl font-bold text-emerald-500 mt-0.5">
              ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors shrink-0"
            style={{ background: "linear-gradient(90deg,#29b6f6,#1e88e5)" }} type="button"
          >
            Add expense
          </button>
        </div>

        {/* Table */}
        <div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                {["Member", "Date", "Description", "Amount", "Category", "Project", "Status"].map((h) => (
                  <th key={h} className="text-left pb-3 text-sm font-semibold text-slate-700 pr-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <ReceiptIllustration size={110} />
                      <p className="text-base text-slate-400">There are no expenses</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((exp, i) => (
                  <motion.tr
                    key={exp.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 pr-5">
                      <div className="flex items-center gap-2.5">
                        <Avatar av={exp.memberAvatar} color={exp.memberColor} />
                        <span className="text-sm text-slate-700 font-medium">{exp.member}</span>
                      </div>
                    </td>
                    <td className="py-3.5 pr-5 text-sm text-slate-600 whitespace-nowrap">{exp.date}</td>
                    <td className="py-3.5 pr-5">
                      <div>
                        <span className="text-sm text-slate-700">{exp.description}</span>
                        {exp.billable && (
                          <span className="ml-2 text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-semibold">
                            Billable
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 pr-5 text-sm font-semibold text-slate-700">
                      ${exp.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 pr-5 text-sm text-slate-600">{exp.category || "—"}</td>
                    <td className="py-3.5 pr-5 text-sm text-slate-600">{exp.project || "—"}</td>
                    <td className="py-3.5">
                      <StatusBadge status={exp.status} />
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showModal && <AddExpenseModal onClose={() => setShowModal(false)} onSave={addExpense} />}
      </AnimatePresence>
    </>
  )
}
