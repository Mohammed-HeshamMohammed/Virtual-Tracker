"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useStandardReportLayout } from "@/features/reports"
import { cn } from "@/shared/utils/utils"

import { StatusBadge, ReceiptIllustration } from "@/features/financials/components/shared/ui-components"
import { FilterDropdown } from "@/features/financials/components/shared/dropdowns"
import { CLIENTS_LIST } from "@/features/financials/components/shared/constants"
import { NewInvoicePage } from "@/features/financials/components/invoices/new-invoice"

type InvoiceTab = "open" | "closed" | "drafts" | "all"

interface Invoice {
  id: string
  number: string
  client: string
  issueDate: string
  daysOld: number
  total: string
  paid: string
  status: string
}

const TABS: Array<{ key: InvoiceTab; label: string }> = [
  { key: "open", label: "OPEN" },
  { key: "closed", label: "CLOSED" },
  { key: "drafts", label: "DRAFTS" },
  { key: "all", label: "ALL" },
]

export function InvoicesReportContent() {
  const { registerExportHandler } = useStandardReportLayout()
  const [tab, setTab] = useState<InvoiceTab>("open")
  const [invoices] = useState<Invoice[]>([])
  const [client, setClient] = useState("All Clients")
  const [isCreating, setIsCreating] = useState(false)

  const filtered = useMemo(() => {
    return invoices.filter((i) => {
      const matchTab = tab === "all" || i.status.toLowerCase() === tab.replace("drafts", "draft")
      const matchClient = client === "All Clients" || i.client === client
      return matchTab && matchClient
    })
  }, [invoices, tab, client])

  const totals = useMemo(() => {
    const parseAmt = (s: string) => parseFloat(s.replace(/[\$,]/g, "")) || 0
    const amt = filtered.reduce((s, i) => s + parseAmt(i.total), 0)
    const pd = filtered.reduce((s, i) => s + parseAmt(i.paid), 0)
    return { amt, pd, due: amt - pd }
  }, [filtered])

  const counts = useMemo(
    () => ({
      open: invoices.filter((i) => i.status === "Open").length,
      closed: invoices.filter((i) => i.status === "Closed").length,
      drafts: invoices.filter((i) => i.status === "Draft").length,
      all: invoices.length,
    }),
    [invoices]
  )

  const handleExportCsv = useCallback(() => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const headers = ["Invoice Number", "Client", "Issue Date", "Days Old", "Total Amount", "Paid Amount", "Status"]
    const lines = [headers.join(",")]
    for (const i of filtered) {
      lines.push(
        [
          esc(i.number),
          esc(i.client),
          esc(i.issueDate),
          esc(String(i.daysOld)),
          esc(i.total),
          esc(i.paid),
          esc(i.status),
        ].join(",")
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `invoices-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, tab])

  useEffect(() => {
    registerExportHandler(isCreating ? null : () => handleExportCsv())
    return () => registerExportHandler(null)
  }, [isCreating, handleExportCsv, registerExportHandler])

  if (isCreating) {
    return <NewInvoicePage onBack={() => setIsCreating(false)} onSave={() => setIsCreating(false)} />
  }

  return (
    <div className="max-w-[1300px] mx-auto space-y-5">
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
        <div className="w-56">
          <FilterDropdown value={client} onChange={setClient} options={CLIENTS_LIST} />
        </div>
      </div>

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

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-10">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">TOTAL INVOICED</div>
            <div className="text-2xl font-bold text-slate-800 mt-0.5">
              ${totals.amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AMOUNT DUE</div>
            <div className="text-2xl font-bold text-emerald-500 mt-0.5">
              ${totals.due.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors shrink-0 shadow-md shadow-blue-500/20"
          style={{ background: "linear-gradient(90deg,#1e88e5,#3949ab)" }} type="button"
        >
          New invoice
        </button>
      </div>

      <div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              {["Invoice #", "Client", "Issue Date", "Days", "Total", "Paid", "Status"].map((h) => (
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
                    <p className="text-base text-slate-400">There are no invoices here</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((inv, i) => (
                <motion.tr
                  key={inv.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                >
                  <td className="py-3.5 pr-5 font-semibold text-slate-800">{inv.number}</td>
                  <td className="py-3.5 pr-5 text-sm text-slate-700">{inv.client}</td>
                  <td className="py-3.5 pr-5 text-sm text-slate-600">{inv.issueDate}</td>
                  <td className="py-3.5 pr-5 text-sm text-slate-500">
                    {inv.status === "Closed" ? "—" : <span className={inv.daysOld > 14 ? "text-amber-500 font-medium" : ""}>{inv.daysOld}d</span>}
                  </td>
                  <td className="py-3.5 pr-5 text-sm font-semibold text-slate-800">{inv.total}</td>
                  <td className="py-3.5 pr-5 text-sm text-slate-600">{inv.paid}</td>
                  <td className="py-3.5">
                    <StatusBadge status={inv.status} />
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
