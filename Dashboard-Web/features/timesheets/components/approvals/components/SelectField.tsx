"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"

interface SelectFieldProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}

export function SelectField<T extends string>({ value, onChange, options }: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false)
  const label = options.find((o) => o.value === value)?.label ?? "Select"

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        <span>{label}</span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full mt-1 z-20 w-full bg-white rounded-xl border border-slate-200 shadow-lg py-1"
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value as T)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 transition-colors",
                    opt.value === value && "bg-blue-50 text-blue-600"
                  )}
                >
                  {opt.label}
                  {opt.value === value && <Check className="w-4 h-4" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
