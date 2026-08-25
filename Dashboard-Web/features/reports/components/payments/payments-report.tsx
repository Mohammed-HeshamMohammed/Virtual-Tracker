"use client"

import { Fragment, useEffect, useState } from "react"
import { useTheme } from "@/shared/providers/app"
import { StandardReportLayout, useStandardReportLayout } from "@/features/reports/components/app"
import { fetchPaymentsReport } from "@/features/reports/api/misc-reports-api"
import type { AmountsOwedDayGroup } from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"

function sumAmountStrings(amountList: string[]): string {
  const total = amountList.reduce((a, v) => a + (Number.parseFloat(v.replace(/[^0-9.-]/g, "")) || 0), 0)
  return `$${total.toFixed(2)}`
}

function PaymentsTable() {
  const { isDark } = useTheme()
  const { rangeStart, rangeEnd, registerExportHandler } = useStandardReportLayout()
  const [groups, setGroups] = useState<AmountsOwedDayGroup[]>([])

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    fetchPaymentsReport({ from, to }).then((data) => {
      if (!cancelled) setGroups(data)
    })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd])

  useEffect(() => {
    const runExport = () => {
      const header = ["Date", "Member", "Rate", "Hours", "Amount"]
      const rows = groups.flatMap((g) => g.members.map((m) => [g.dateLabel, m.name, m.rateLabel, m.hours, m.amount]))
      const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    registerExportHandler(runExport)
    return () => registerExportHandler(null)
  }, [groups, registerExportHandler])

  const th = cn(
    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-white/40" : "text-slate-500"
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10" : "border-slate-200")}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={cn("border-b", isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-slate-50")}>
            <th className={th}>Member</th>
            <th className={cn(th, "text-center")}>Rate</th>
            <th className={cn(th, "text-right")}>Hours</th>
            <th className={cn(th, "text-right")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn("px-4 py-12 text-center text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                No tracked time in this date range.
              </td>
            </tr>
          ) : null}
          {groups.map((group) => (
            <Fragment key={group.date}>
              <tr className={cn(isDark ? "bg-white/6" : "bg-slate-100")}>
                <td colSpan={4} className={cn("px-4 py-2 text-xs font-semibold uppercase tracking-wide", isDark ? "text-white/50" : "text-slate-500")}>
                  {group.dateLabel}
                </td>
              </tr>
              {group.members.map((m) => (
                <tr key={`${group.date}-${m.name}`} className={cn("border-b last:border-b-0", isDark ? "border-white/10" : "border-slate-100")}>
                  <td className={cn("px-4 py-3", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{m.name}</td>
                  <td className={cn("px-4 py-3 text-center", isDark ? "text-white/45" : "text-slate-500")}>{m.rateLabel}</td>
                  <td className={cn("px-4 py-3 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{m.hours}</td>
                  <td className={cn("px-4 py-3 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{m.amount}</td>
                </tr>
              ))}
              <tr className={cn("border-t-2 font-semibold", isDark ? "border-white/10" : "border-slate-200")}>
                <td className={cn("px-4 py-3", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Total</td>
                <td />
                <td />
                <td className={cn("px-4 py-3 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                  {sumAmountStrings(group.members.map((x) => x.amount))}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PaymentsReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <StandardReportLayout title="Payments report" onNavigate={onNavigate} exportFileBaseName="payments" showScopeTabs={false} showGroupBy={false}>
      <PaymentsTable />
    </StandardReportLayout>
  )
}
