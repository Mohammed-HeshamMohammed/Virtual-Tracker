"use client"

import { useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SUB_INVOICES, BILLING_INVOICES_PAGE_SIZE } from "@/features/settings/components/shared/constants"

type InvoiceFilter = "all" | "paid" | "unpaid"

export function SubscriptionInvoices() {
  const [filter, setFilter] = useState<InvoiceFilter>("all")
  const [page, setPage] = useState(0)

  const filtered = SUB_INVOICES.filter(i => {
    if (filter === "paid") return i.status === "Paid"
    if (filter === "unpaid") return i.status !== "Paid" && i.status !== "Upcoming"
    return true
  })

  const pages = Math.ceil(filtered.length / BILLING_INVOICES_PAGE_SIZE)
  const slice = filtered.slice(page * BILLING_INVOICES_PAGE_SIZE, (page + 1) * BILLING_INVOICES_PAGE_SIZE)

  const counts = {
    all: SUB_INVOICES.length,
    paid: SUB_INVOICES.filter(i => i.status === "Paid").length,
    unpaid: SUB_INVOICES.filter(i => i.status !== "Paid" && i.status !== "Upcoming").length,
  }

  const tabs: { k: InvoiceFilter; label: string }[] = [
    { k: "all",    label: `ALL INVOICES (${counts.all})` },
    { k: "paid",   label: `PAID (${counts.paid})` },
    { k: "unpaid", label: `UNPAID (${counts.unpaid})` },
  ]

  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t.k}
            onClick={() => { setFilter(t.k); setPage(0) }}
            className={cn(
              "pb-3 text-xs font-bold border-b-2 transition-colors",
              filter === t.k ? "border-blue-500 text-blue-500" : "border-transparent text-slate-400 hover:text-slate-600"
            )} type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {["Amount", "Invoice number", "Transaction", "Description", "Due", "Created on"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{h}</th>
              ))}
              <th className="w-8" aria-label="Interactive control" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-sm text-slate-400 text-center">No invoices</td>
              </tr>
            ) : slice.map(inv => (
              <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">{inv.amount}</span>
                    <span className="text-xs text-slate-400">{inv.currency}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-xs font-semibold",
                      inv.status === "Paid"     ? "bg-emerald-100 text-emerald-700" :
                      inv.status === "Upcoming" ? "bg-slate-700 text-white" :
                                                  "bg-red-100 text-red-600"
                    )}>
                      {inv.status}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-slate-400">{inv.number}</td>
                <td className="px-4 py-3.5 text-sm text-slate-600">{inv.transaction}</td>
                <td className="px-4 py-3.5 text-sm text-slate-600">{inv.description}</td>
                <td className="px-4 py-3.5 text-sm text-slate-400">{inv.due}</td>
                <td className="px-4 py-3.5 text-sm text-slate-700">{inv.created}</td>
                <td className="px-4 py-3.5"><ChevronDown className="w-4 h-4 text-slate-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {pages > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">
              Showing {page * BILLING_INVOICES_PAGE_SIZE + 1}–{Math.min((page + 1) * BILLING_INVOICES_PAGE_SIZE, filtered.length)} of {filtered.length} invoices
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => p - 1)} disabled={page === 0}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors" type="button"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i} onClick={() => setPage(i)}
                  className={cn(
                    "w-7 h-7 rounded text-xs font-medium transition-colors",
                    i === page ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-slate-100"
                  )} type="button"
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setPage(p => p + 1)} disabled={page === pages - 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors" type="button"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
