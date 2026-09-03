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
  disabled = false,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  width?: string
  accentBar?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const label = options.find((o) => o.value === value)?.label ?? (value ? value : (placeholder ?? value))
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition-colors",
          width,
          disabled ? "cursor-not-allowed opacity-60" : "hover:bg-slate-50 dark:hover:bg-slate-800",
        )}
      >
        {accentBar && <span className="h-5 w-0.5 shrink-0 rounded-full bg-blue-400 dark:bg-blue-500" />}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      </button>
      <AnimatePresence>
        {open && !disabled && (
          <>
            <div className="fixed inset-0 z-35 bg-transparent" onClick={() => setOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "absolute left-0 top-full z-45 mt-1 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-lg",
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
                  className="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" type="button"
                >
                  {opt.label}
                  {opt.value === value && <Check className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

