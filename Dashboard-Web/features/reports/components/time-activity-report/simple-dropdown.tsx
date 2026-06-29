/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function ReportSimpleDropdown({
  value,
  onChange,
  options,
  width = "w-44",
  accentBar = true,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  width?: string
  accentBar?: boolean
}) {
  const [open, setOpen] = useState(false)
  const label = options.find((o) => o.value === value)?.label ?? value
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
      >
        {accentBar && <span className="h-5 w-0.5 shrink-0 rounded-full bg-blue-400" />}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-35 bg-transparent" onClick={() => setOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute left-0 top-full z-45 mt-1 rounded-xl border border-slate-100 bg-white py-1 shadow-lg",
                width
              )}
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" type="button"
                >
                  {opt.label}
                  {opt.value === value && <Check className="h-3.5 w-3.5 text-blue-500" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

