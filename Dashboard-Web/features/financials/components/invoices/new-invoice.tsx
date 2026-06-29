/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState as useComponentState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Calendar, FileText, ChevronDown, Check, Download, Layers, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SingleDatePicker } from "@/features/financials/components/shared/date-pickers"
import { FilterDropdown } from "@/features/financials/components/shared/dropdowns"
import { CLIENTS_LIST } from "@/features/financials/components/shared/constants"
import { GenerateLineItemsModal } from "@/features/financials/components/invoices/generate-line-items-modal"
import { fmtShort } from "@/features/financials/components/shared/date-pickers"

export function NewInvoicePage({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [client, setClient] = useComponentState(CLIENTS_LIST[1])
  const [issueDate, setIssueDate] = useComponentState<Date>(new Date())
  const [showIssueDate, setShowIssueDate] = useComponentState(false)
  const [poNumber, setPoNumber] = useComponentState("")

  const [lines, setLines] = useComponentState<any[]>([])
  const [tax, setTax] = useComponentState("0")
  const [discount, setDiscount] = useComponentState("0")

  const [notes, setNotes] = useComponentState("")
  const [terms, setTerms] = useComponentState("")

  const [showGenerateModal, setShowGenerateModal] = useComponentState(false)

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0)
  const taxAmt = subtotal * ((parseFloat(tax) || 0) / 100)
  const discAmt = parseFloat(discount) || 0
  const total = subtotal + taxAmt - discAmt

  function handleGenerate() {
    setLines([
      { id: "1", desc: "Frontend Architecture - Sarah Johnson", qty: "40", rate: "85", amt: "3400.00" },
      { id: "2", desc: "API Development - Mike Chen", qty: "20", rate: "70", amt: "1400.00" },
    ])
  }

  const inputCls =
    "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-[900px] mx-auto pb-20 space-y-8"
    >
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors" type="button">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">New invoice</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8">
        <div className="space-y-8">
          {/* Header section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">Client</label>
              <FilterDropdown value={client} onChange={setClient} options={CLIENTS_LIST} />
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Issue date</label>
                <div className="relative">
                  <div
                    onClick={() => setShowIssueDate((v) => !v)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer transition-colors bg-white",
                      showIssueDate ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
                    )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                  >
                    <span className="text-sm text-slate-700">{fmtShort(issueDate)}</span>
                    <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                  </div>
                  <AnimatePresence>
                    {showIssueDate && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowIssueDate(false)} />
                        <SingleDatePicker value={issueDate} onChange={setIssueDate} onClose={() => setShowIssueDate(false)} theme="white" />
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" aria-label="Interactive control">PO Number (Optional)</label>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-12345" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Line items section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Line items</h3>
              <button
                onClick={() => setShowGenerateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors" type="button"
              >
                <Layers className="w-4 h-4" />
                Generate from time & expenses
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-xl">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No line items yet. Generate or add manually.</p>
                <button
                  onClick={() => setLines([...lines, { id: Date.now().toString(), desc: "", qty: "", rate: "", amt: "0.00" }])}
                  className="mt-4 px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50" type="button"
                >
                  Add manual line item
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_80px_100px_100px_40px] gap-3 px-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Qty</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Rate</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Amount</div>
                  <div />
                </div>
                {lines.map((l, i) => (
                  <div key={l.id} className="grid grid-cols-[1fr_80px_100px_100px_40px] gap-3 items-center group">
                    <input
                      value={l.desc}
                      onChange={(e) => {
                        const n = [...lines]; n[i].desc = e.target.value; setLines(n)
                      }}
                      placeholder="Item description"
                      className={inputCls} aria-label="Interactive control"
                    />
                    <input
                      type="number"
                      value={l.qty}
                      onChange={(e) => {
                        const n = [...lines]; n[i].qty = e.target.value
                        n[i].amt = ((parseFloat(n[i].qty) || 0) * (parseFloat(n[i].rate) || 0)).toFixed(2)
                        setLines(n)
                      }}
                      placeholder="0"
                      className={cn(inputCls, "text-right")} aria-label="Interactive control"
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                      <input
                        type="number"
                        value={l.rate}
                        onChange={(e) => {
                          const n = [...lines]; n[i].rate = e.target.value
                          n[i].amt = ((parseFloat(n[i].qty) || 0) * (parseFloat(n[i].rate) || 0)).toFixed(2)
                          setLines(n)
                        }}
                        placeholder="0.00"
                        className={cn(inputCls, "text-right pl-7")}
                      />
                    </div>
                    <div className="text-right text-sm font-medium text-slate-700 pt-2">${l.amt}</div>
                    <button
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-lg hover:bg-red-50 justify-self-end" type="button"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setLines([...lines, { id: Date.now().toString(), desc: "", qty: "", rate: "", amt: "0.00" }])}
                  className="text-sm font-semibold text-blue-500 hover:text-blue-600 mt-2 px-2 py-1" type="button"
                >
                  + Add line item
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5" aria-label="Interactive control">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} placeholder="Notes visible to client..." aria-label="Interactive control" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Terms</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={inputCls} placeholder="Payment terms..." />
            </div>
          </div>
        </div>

        {/* Totals Sidebar */}
        <div>
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 sticky top-6">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-5">Summary</h3>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between text-slate-600" aria-label="Interactive control">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-slate-600 shrink-0">Tax (%)</span>
                <input type="number" value={tax} onChange={(e) => setTax(e.target.value)} className={cn(inputCls, "w-20 text-right py-1.5")} aria-label="Interactive control" />
              </div>
              <div className="flex justify-between items-center gap-4 pb-4 border-b border-slate-200">
                <span className="text-slate-600 shrink-0">Discount ($)</span>
                <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className={cn(inputCls, "w-24 text-right py-1.5")} />
              </div>
              <div className="flex justify-between items-end pt-2">
                <span className="text-base font-bold text-slate-800">Total</span>
                <span className="text-2xl font-black text-emerald-500">${Math.max(0, total).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <button
              onClick={onSave}
              className="w-full mt-8 py-3 bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all hover:-translate-y-0.5 active:translate-y-0" type="button"
            >
              Save as draft
            </button>
            <button className="w-full mt-3 py-3 bg-white text-slate-700 font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors" type="button">
              Preview invoice
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showGenerateModal && <GenerateLineItemsModal onClose={() => setShowGenerateModal(false)} onGenerate={handleGenerate} />}
      </AnimatePresence>
    </motion.div>
  )
}
