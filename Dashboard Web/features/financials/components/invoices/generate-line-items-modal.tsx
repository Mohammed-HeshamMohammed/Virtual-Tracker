/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState as useComponentState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, Search, ChevronDown, Check, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { DateRangePicker } from "@/features/financials/components/shared/date-pickers"
import { FilterDropdown, ProjectDropdown, MemberDropdown } from "@/features/financials/components/shared/dropdowns"
import { PROJECTS_LIST, MEMBERS_LIST, TODOS_LIST, LINE_ITEMS_OPTIONS } from "@/features/financials/components/shared/constants"

export function GenerateLineItemsModal({
  onClose,
  onGenerate,
}: {
  onClose: () => void
  onGenerate: () => void
}) {
  const [format, setFormat] = useComponentState(LINE_ITEMS_OPTIONS[0])
  const [showDates, setShowDates] = useComponentState(false)
  const [dateRange, setDateRange] = useComponentState("Mar 1, 2026 - Mar 31, 2026")
  
  const [project, setProject] = useComponentState("All projects")
  const [member, setMember] = useComponentState<string | null>(null)
  const [todo, setTodo] = useComponentState("All to-dos")

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
        className="bg-white rounded-2xl w-full max-w-[500px] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">Generate line items</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" type="button">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-slate-600 leading-relaxed">
            Generate line items from uninvoiced tracked time and expenses for the selected criteria.
          </p>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">
              Format line items*
            </label>
            <FilterDropdown value={format} onChange={setFormat} options={LINE_ITEMS_OPTIONS} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Date range
            </label>
            <div className="relative">
              <div
                onClick={() => setShowDates((v) => !v)}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer transition-colors bg-white",
                  showDates ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
                )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
              >
                <span className="text-sm text-slate-700">{dateRange}</span>
                <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
              </div>
              <AnimatePresence>
                {showDates && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowDates(false)} />
                    <DateRangePicker
                      theme="blue"
                      firstDayOfWeek={0}
                      minWidth={600}
                      onApply={(r) => { setDateRange(r); setShowDates(false) }}
                      onCancel={() => setShowDates(false)}
                    />
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Project
            </label>
            <ProjectDropdown value={project} onChange={setProject} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Member
            </label>
            <MemberDropdown label="All members" selected={member} onSelect={setMember} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
              To-do
            </label>
            <FilterDropdown value={todo} onChange={setTodo} options={TODOS_LIST} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-lg hover:bg-slate-50 transition-colors" type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onGenerate()
              onClose()
            }}
            className="px-6 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors" type="button"
          >
            Generate
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
