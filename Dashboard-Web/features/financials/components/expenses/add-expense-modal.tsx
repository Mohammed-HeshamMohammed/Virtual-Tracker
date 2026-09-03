"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getProjects } from "@/features/projects/api/project-api"
import { EXPENSE_CATEGORIES, createExpense } from "@/features/expenses/api/expense-api"

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:ring-1 focus:ring-blue-400"

const labelCls = "mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function AddExpenseModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [description, setDescription] = useState("")
  const [date, setDate] = useState(todayLocal)
  const [amount, setAmount] = useState("")
  const [category, setCategory] = useState("other")
  const [projectId, setProjectId] = useState("")
  const [notes, setNotes] = useState("")
  const [billable, setBillable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getProjects({ fields: ["id", "name", "status"] })
      .then((rows) => {
        if (cancelled) return
        setProjects(
          rows
            .filter((p) => String(p.status ?? "").toLowerCase() !== "archived")
            .map((p) => ({ id: String(p.id), name: String(p.name ?? "Untitled project") }))
        )
      })
      .catch(() => setProjects([]))
    return () => {
      cancelled = true
    }
  }, [open])

  function reset() {
    setDescription("")
    setDate(todayLocal())
    setAmount("")
    setCategory("other")
    setProjectId("")
    setNotes("")
    setBillable(false)
    setError(null)
  }

  async function save() {
    const parsedAmount = Number(amount)
    if (!description.trim()) {
      setError("Add a description.")
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter an amount greater than zero.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createExpense({
        date,
        category,
        description: description.trim(),
        notes: notes.trim(),
        amount: parsedAmount,
        billable,
        projectId: projectId || null,
      })
      reset()
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this expense.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 8, opacity: 0 }}
            className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-800">Add expense</h2>
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label htmlFor="exp-description" className={labelCls}>
                  Description *
                </label>
                <input
                  id="exp-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What was this for?"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="exp-date" className={labelCls}>
                    Date *
                  </label>
                  <input
                    id="exp-date"
                    type="date"
                    value={date}
                    max={todayLocal()}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="exp-amount" className={labelCls}>
                    Amount *
                  </label>
                  <input
                    id="exp-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="exp-category" className={labelCls}>
                    Category *
                  </label>
                  <select
                    id="exp-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputCls}
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="exp-project" className={labelCls}>
                    Project
                  </label>
                  <select
                    id="exp-project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="exp-notes" className={labelCls}>
                  Notes
                </label>
                <textarea
                  id="exp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Anything the reviewer should know"
                  className={cn(inputCls, "resize-y")}
                />
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">Billable to the client</span>
              </label>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Add expense"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
