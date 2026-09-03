"use client"

import { useState as useComponentState, useMemo, useCallback, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Calendar } from "lucide-react"
import { useStandardReportLayout } from "@/features/reports"
import { cn } from "@/shared/utils/utils"

import { FilterDropdown } from "@/features/financials/components/shared/dropdowns"
import { TEAMS_LIST } from "@/features/financials/components/shared/constants"
import { StatusBadge, ReceiptIllustration } from "@/features/financials/components/shared/ui-components"
import { DateRangePicker } from "@/features/financials/components/shared/date-pickers"

export function PaymentRecordsContent() {
  const { registerExportHandler } = useStandardReportLayout()
  const [records] = useComponentState<{
    id: string
    name: string
    dateRange: string
    members: number
    amount: string
    status: string
    paidOn: string
    createdOn: string
    createdBy: string
  }[]>([])
  
  const [searchQ, setSearchQ] = useComponentState("")
  const [team, setTeam] = useComponentState("All teams")
  const [dateRange, setDateRange] = useComponentState("All dates")
  const [showDates, setShowDates] = useComponentState(false)

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const matchSearch = r.name.toLowerCase().includes(searchQ.toLowerCase()) || r.id.toLowerCase().includes(searchQ.toLowerCase())
      return matchSearch
    })
  }, [records, searchQ])

  const handleExportCsv = useCallback(() => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const headers = ["ID", "Name", "Date Range", "Members", "Amount", "Status", "Paid On", "Created On", "Created By"]
    const lines = [headers.join(",")]
    for (const r of filtered) {
      lines.push(
        [
          esc(r.id),
          esc(r.name),
          esc(r.dateRange),
          esc(String(r.members)),
          esc(r.amount),
          esc(r.status),
          esc(r.paidOn),
          esc(r.createdOn),
          esc(r.createdBy),
        ].join(",")
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `payment-records-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  useEffect(() => {
    registerExportHandler(() => handleExportCsv())
    return () => registerExportHandler(null)
  }, [handleExportCsv, registerExportHandler])

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search records..."
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors" aria-label="Interactive control"
          />
        </div>
        <div className="w-48">
          <FilterDropdown value={team} onChange={setTeam} options={TEAMS_LIST} />
        </div>
        <div className="w-56 relative">
          <div
            onClick={() => setShowDates((v) => !v)}
            className={cn(
              "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer transition-colors bg-white",
              showDates ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
            )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
          >
            <span className="text-sm text-slate-700">{dateRange}</span>
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          {showDates && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowDates(false)} />
              <DateRangePicker
                theme="white"
                firstDayOfWeek={0}
                minWidth={600}
                onApply={(r) => { setDateRange(r); setShowDates(false) }}
                onCancel={() => setShowDates(false)}
              />
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Run details</th>
                <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date range</th>
                <th className="text-right px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Members</th>
                <th className="text-right px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Paid on</th>
                <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <ReceiptIllustration size={100} />
                      <p className="text-sm text-slate-400">No payment records found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer group"
                  >
                    <td className="px-5 py-4">
                      <div className="text-sm font-bold text-slate-800">{r.name}</div>
                      <div className="text-[11px] font-medium text-slate-400 mt-0.5">{r.id}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600 whitespace-nowrap">{r.dateRange}</td>
                    <td className="px-5 py-4 text-sm text-slate-600 text-right">{r.members}</td>
                    <td className="px-5 py-4 text-sm font-bold text-slate-800 text-right">{r.amount}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600 whitespace-nowrap">{r.paidOn}</td>
                    <td className="px-5 py-4">
                      <div className="text-sm text-slate-600 whitespace-nowrap">{r.createdOn}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">by {r.createdBy}</div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
