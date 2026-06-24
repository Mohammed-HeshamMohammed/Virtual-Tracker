/* eslint-disable react-doctor/use-lazy-motion, react-doctor/no-derived-useState */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function ReportFilterDropdown({ label, options }: { label: string; options: string[] }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(label)
  const [selected, setSelected] = useState<Set<string>>(new Set([options[0]]))
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between rounded-xl border bg-white px-4 py-3 text-sm text-slate-700 transition-colors hover:border-blue-400",
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
        )} type="button"
      >
        <span className="text-slate-600">{value}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-50 px-4 py-2.5">
              <button className="text-sm font-medium text-blue-500" onClick={() => setSelected(new Set(options))} type="button">
                Select all
              </button>
              <button className="text-sm font-medium text-blue-500" onClick={() => setSelected(new Set())} type="button">
                Unselect all
              </button>
            </div>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  const s = new Set(selected)
                  s.has(opt) ? s.delete(opt) : s.add(opt)
                  setSelected(s)
                  setValue(s.size === 1 ? [...s][0]! : s.size === 0 ? label : `${s.size} selected`)
                }}
                className={cn(
                  "w-full px-4 py-3 text-left text-sm transition-colors",
                  selected.has(opt) ? "bg-blue-500 font-semibold text-white" : "text-slate-700 hover:bg-slate-50"
                )} type="button"
              >
                {opt}
              </button>
            ))}
            <div className="border-t border-slate-50 px-4 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Show only selected
              </div>
              <button
                onClick={() => setShowOnlySelected((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors",
                  showOnlySelected ? "bg-blue-500" : "bg-slate-200"
                )} type="button" aria-label="Interactive control"
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                    showOnlySelected ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

