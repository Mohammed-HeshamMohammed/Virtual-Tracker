"use client"

import { useState as useComponentState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, Layers, Clock, FileText, X, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { DateRangePicker } from "@/features/financials/components/shared/date-pickers"
import { FilterDropdown, ProjectDropdown, MemberDropdown } from "@/features/financials/components/shared/dropdowns"
import { Avatar, StatusBadge } from "@/features/financials/components/shared/ui-components"
import { TEAMS_LIST } from "@/features/financials/components/shared/constants"

type PayTab = "hours" | "approved" | "onetime"

type PayRow = {
  id: string
  name: string
  avatar: string
  color: string
  rate: string
  unpaidHours: string
  unpaidTotal: string
}

type ApprovedPayRow = PayRow & {
  payPeriod: string
  currentRate: string
}

export function CreatePaymentsContent() {
  const [tab, setTab] = useComponentState<PayTab>("hours")
  const [dateRange, setDateRange] = useComponentState("Mar 1, 2026 - Mar 15, 2026")
  const [showDates, setShowDates] = useComponentState(false)

  const [team, setTeam] = useComponentState("All teams")
  const [project, setProject] = useComponentState("All projects")
  const [member, setMember] = useComponentState<string | null>(null)
  
  const [payRows] = useComponentState<PayRow[]>([])
  const [approvedRows] = useComponentState<ApprovedPayRow[]>([])

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex border-b border-slate-200">
        {[
          { id: "hours" as const, label: "Pay for hours", icon: Clock },
          { id: "approved" as const, label: "Approved timesheets", icon: FileText },
          { id: "onetime" as const, label: "One-time amount", icon: Layers },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-6 py-4 text-sm font-semibold border-b-2 transition-colors",
              tab === t.id ? "border-blue-500 text-blue-500" : "border-transparent text-slate-500 hover:text-slate-700"
            )} type="button"
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-8 items-start">
        <div className="flex-1 space-y-6">
          {tab === "hours" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
              <h2 className="text-lg font-bold text-slate-800">Filter hours</h2>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">Date range</label>
                  <div className="relative">
                    <div
                      onClick={() => setShowDates((v) => !v)}
                      className={cn(
                        "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer transition-colors",
                        showDates ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
                      )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                    >
                      <span className="text-sm text-slate-700">{dateRange}</span>
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                    {showDates && (
                      <DateRangePicker onApply={(r) => { setDateRange(r); setShowDates(false) }} onCancel={() => setShowDates(false)} />
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Team</label>
                  <FilterDropdown value={team} onChange={setTeam} options={TEAMS_LIST} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">Project</label>
                  <ProjectDropdown value={project} onChange={setProject} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Member</label>
                  <MemberDropdown label="All members" selected={member} onSelect={setMember} />
                </div>
              </div>
              
              <div className="pt-4 mt-2 border-t border-slate-100">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Member</th>
                      <th className="text-left pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rate</th>
                      <th className="text-right pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unpaid Hrs</th>
                      <th className="text-right pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payRows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        <td className="py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar av={r.avatar} color={r.color} />
                            <span className="text-sm font-medium text-slate-700">{r.name}</span>
                          </div>
                        </td>
                        <td className="py-3 text-sm text-slate-600">{r.rate}</td>
                        <td className="py-3 text-sm text-slate-600 text-right">{r.unpaidHours}</td>
                        <td className="py-3 text-sm font-bold text-slate-800 text-right">{r.unpaidTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "approved" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Member</th>
                    <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pay Period</th>
                    <th className="text-left px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rate</th>
                    <th className="text-right px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Approved Hrs</th>
                    <th className="text-right px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {approvedRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar av={r.avatar} color={r.color} />
                          <span className="text-sm font-medium text-slate-700">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">{r.payPeriod}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{r.currentRate}</td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-700 text-right">{r.unpaidHours}</td>
                      <td className="px-5 py-4 text-sm font-bold text-slate-800 text-right">{r.unpaidTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "onetime" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5 max-w-xl">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Member</label>
                <MemberDropdown label="Select member" selected={member} onSelect={setMember} />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Amount</label>
                  <div className="flex relative" aria-label="Interactive control">
                    <span className="absolute left-3 top-2.5 text-slate-400">$</span>
                    <input type="number" placeholder="0.00" className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-blue-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>Date</label>
                  <div className="relative">
                    <div
                      onClick={() => setShowDates((v) => !v)}
                      className={cn(
                        "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer transition-colors bg-white",
                        showDates ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <span className="text-sm text-slate-700">Mar 22, 2026</span>
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" aria-label="Interactive control" />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Description</label>
                <input placeholder="Bonus, expense reimbursement, etc." className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-blue-400" />
              </div>
              <button className="w-full py-2.5 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors" type="button">
                Add to queue
              </button>
            </div>
          )}
        </div>

        <div className="w-[320px] shrink-0 sticky top-6">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-5">Payment queue</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Hours ({payRows.length})</span>
                <span className="font-semibold text-slate-800">$6,715.75</span>
              </div>
              <div className="flex justify-between items-center text-sm pb-4 border-b border-slate-200">
                <span className="text-slate-600">One-time (0)</span>
                <span className="font-semibold text-slate-800">$0.00</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-base font-bold text-slate-800">Total</span>
                <span className="text-2xl font-black text-blue-500">$6,715.75</span>
              </div>
            </div>
            <button className="w-full mt-6 py-3 bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all" type="button">
              Review and pay
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
