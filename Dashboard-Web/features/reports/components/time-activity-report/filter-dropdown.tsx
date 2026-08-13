/* eslint-disable react-doctor/use-lazy-motion, react-doctor/no-derived-useState */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function ReportFilterDropdown({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string
  options: string[]
  /** Controlled single-select value (e.g. a real filter option). Falls back to internal-only state when omitted. */
  selectedValue?: string
  /** Called with the picked option when controlled. */
  onSelect?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [localValue, setLocalValue] = useState(label)
  const [selected, setSelected] = useState<Set<string>>(new Set([options[0]]))
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  const controlled = selectedValue !== undefined && onSelect !== undefined
  const value = selectedValue ?? localValue

  if (controlled) {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:border-blue-400 dark:hover:border-blue-500",
            open ? "border-blue-400 dark:border-blue-500 ring-1 ring-blue-400 dark:ring-blue-500" : "border-slate-200 dark:border-slate-700"
          )}
          type="button"
        >
          <span className="text-slate-600 dark:text-slate-300">{value}</span>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1 }}
              className="mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
            >
              {options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    onSelect(opt)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full px-4 py-3 text-left text-sm transition-colors",
                    opt === selectedValue
                      ? "bg-blue-500 dark:bg-blue-600 font-semibold text-white"
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  )}
                  type="button"
                >
                  {opt}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:border-blue-400 dark:hover:border-blue-500",
          open ? "border-blue-400 dark:border-blue-500 ring-1 ring-blue-400 dark:ring-blue-500" : "border-slate-200 dark:border-slate-700"
        )} type="button"
      >
        <span className="text-slate-600 dark:text-slate-300">{value}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800 px-4 py-2.5">
              <button className="text-sm font-medium text-blue-500 dark:text-blue-400" onClick={() => setSelected(new Set(options))} type="button">
                Select all
              </button>
              <button className="text-sm font-medium text-blue-500 dark:text-blue-400" onClick={() => setSelected(new Set())} type="button">
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
                  setLocalValue(s.size === 1 ? [...s][0]! : s.size === 0 ? label : `${s.size} selected`)
                }}
                className={cn(
                  "w-full px-4 py-3 text-left text-sm transition-colors",
                  selected.has(opt)
                    ? "bg-blue-500 dark:bg-blue-600 font-semibold text-white"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                )} type="button"
              >
                {opt}
              </button>
            ))}
            <div className="border-t border-slate-50 dark:border-slate-800 px-4 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Show only selected
              </div>
              <button
                onClick={() => setShowOnlySelected((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors",
                  showOnlySelected ? "bg-blue-500 dark:bg-blue-600" : "bg-slate-200 dark:bg-slate-700"
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

