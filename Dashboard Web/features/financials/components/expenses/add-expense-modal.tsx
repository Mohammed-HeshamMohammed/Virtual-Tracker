/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState as useComponentState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, X, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SingleDatePicker } from "@/features/financials/components/shared/date-pickers"
import { CategoryDropdown, ProjectDropdown } from "@/features/financials/components/shared/dropdowns"
import { ReceiptIllustration } from "@/features/financials/components/shared/ui-components"
import { MEMBER_AVATARS, PROJECTS_LIST, CATEGORIES } from "@/features/financials/components/shared/constants"
import { fmtShort } from "@/features/financials/components/shared/date-pickers"
import { parsePositiveNumber, validateRequiredText } from "@/shared/validation"

// The modal expects to be placed inside an AnimatePresence
export function AddExpenseModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (e: any) => void
}) {
  const [description, setDescription] = useComponentState("")
  const [date, setDate] = useComponentState<Date>(new Date(2026, 2, 22))
  const [showDate, setShowDate] = useComponentState(false)
  const [amount, setAmount] = useComponentState("")
  const [category, setCategory] = useComponentState("")
  const [project, setProject] = useComponentState("")
  const [notes, setNotes] = useComponentState("")
  const [billable, setBillable] = useComponentState(false)
  const [receiptFile, setReceiptFile] = useComponentState<string | null>(null)
  const [dragging, setDragging] = useComponentState(false)
  const [saveError, setSaveError] = useComponentState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function save() {
    const descriptionError = validateRequiredText(description, "Description")
    const amountError = parsePositiveNumber(amount) === null ? "Enter a valid amount greater than zero." : null
    const validationError = descriptionError ?? amountError
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaveError(null)
    const av = Object.entries(MEMBER_AVATARS).find(() => true)!
    onSave({
      member: "Sarah Johnson",
      memberAvatar: "SJ",
      memberColor: "#6366f1",
      date: fmtShort(date).replace(/,\s\d{4}/, ", 2026"), // formatting string as before
      description,
      amount: parseFloat(amount) || 0,
      category,
      project,
      billable,
      receipt: receiptFile ?? undefined,
    })
    onClose()
  }

  const inputCls =
    "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl w-full max-w-[900px] shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">New expense</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" type="button">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left form */}
          <div className="flex-1 px-7 pb-6 overflow-y-auto space-y-4">
            {saveError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
            ) : null}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">
                DESCRIPTION*
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className={inputCls} aria-label="Interactive control"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  DATE*
                </label>
                <div className="relative">
                  <div
                    onClick={() => setShowDate((v) => !v)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer hover:border-blue-400 transition-colors bg-white",
                      showDate ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
                    )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                  >
                    <span className="text-sm text-slate-700">{fmtShort(date)}</span>
                    <Calendar className="w-5 h-5 text-blue-500 shrink-0 ml-2" />
                  </div>
                  <AnimatePresence>
                    {showDate && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowDate(false)} />
                        <SingleDatePicker value={date} onChange={(d) => setDate(d)} onClose={() => setShowDate(false)} />
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" aria-label="Interactive control">
                  AMOUNT*
                </label>
                <div className="flex">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount"
                    min={0}
                    className="flex-1 min-w-0 px-3 py-2.5 border border-r-0 border-slate-200 rounded-l-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 transition-colors"
                  />
                  <span className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-r-lg text-sm text-slate-500 font-medium shrink-0">
                    USD
                  </span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">
                CATEGORY*
              </label>
              <CategoryDropdown value={category} onChange={setCategory} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">
                PROJECT
              </label>
              <ProjectDropdown value={project} onChange={setProject} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                NOTES
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                rows={4}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 resize-y focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
              />
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => setBillable((v) => !v)}
                className={cn(
                  "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0",
                  billable ? "bg-blue-500 border-blue-500" : "border-slate-300"
                )}
              >
                {billable && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className="text-sm text-slate-700">Billable</span>
            </label>
          </div>

          {/* Right receipt upload */}
          <div className="w-72 px-6 py-6 border-l border-slate-100 flex flex-col shrink-0">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files[0]
                if (f) setReceiptFile(f.name)
              }}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-colors p-4 text-center",
                dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50/50 hover:border-blue-300"
              )} aria-label="Interactive control"
            >
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setReceiptFile(f.name)
                }}
              />
              {receiptFile ? (
                <div className="space-y-2">
                  <ReceiptIllustration size={80} />
                  <p className="text-sm font-medium text-blue-500 break-all">{receiptFile}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setReceiptFile(null)
                    }}
                    className="text-xs text-red-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <ReceiptIllustration size={90} />
                  <p className="text-sm text-slate-500 mt-3 leading-relaxed">
                    Drag and drop your receipt here or browse to upload.
                  </p>
                  <button
                    type="button"
                    className="mt-4 px-5 py-2 border border-blue-400 text-blue-500 text-sm font-semibold rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    Browse files
                  </button>
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    Accepted file formats
                    <br />
                    JPG, JPEG, PNG, GIF, PDF, HTML, TXT, RTF,
                    <br />
                    DOC, DOCX, HTM, TIFF, TIF, and XML.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-7 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors" type="button"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!description.trim() || !amount}
            className="px-7 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" type="button"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
