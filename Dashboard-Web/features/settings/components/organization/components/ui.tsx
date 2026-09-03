"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"

interface Dark { isDark?: boolean }

export const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button onClick={onChange} className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", checked ? "bg-[#006e2f]" : "bg-slate-200")} type="button">
    <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center", checked ? "translate-x-5" : "translate-x-0")}>
      {checked && <svg className="w-3 h-3 text-[#006e2f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  </button>
)

export const Segment = ({ options, value, onChange, isDark }: { options: string[]; value: string; onChange: (v: string) => void } & Dark) => (
  <div className={cn("inline-flex rounded-full border p-0.5 text-sm", isDark ? "border-white/10 bg-[#1a2235]" : "border-slate-200 bg-white")}>
    {options.map((opt) => (
      <button key={opt} onClick={() => onChange(opt)} className={cn("px-5 py-1.5 rounded-full font-medium transition-all",
        value === opt
          ? isDark ? "bg-white/10 text-white shadow-sm" : "bg-slate-700 text-white shadow-sm"
          : isDark ? "text-white/40 hover:text-white/70" : "text-slate-500 hover:text-slate-700"
      )} type="button">{opt}</button>
    ))}
  </div>
)

export const Label = ({ label, required, info, isDark }: { label: string; required?: boolean; info?: string } & Dark) => (
  <div className="flex items-center gap-1 mb-1.5">
    <label className={cn("text-[11px] font-semibold tracking-widest uppercase", isDark ? "text-white/40" : "text-slate-500")}>
      {label}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
    {info && (
      <div className="group relative inline-flex items-center">
        <Info className={cn("w-3.5 h-3.5 cursor-help", isDark ? "text-white/30" : "text-slate-400")} />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg border border-slate-700">
          {info}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
        </div>
      </div>
    )}
  </div>
)

export const Input = ({ isDark, isArea, ...props }: React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> & { isArea?: boolean } & Dark) => {
  const className = cn(
    "w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#006e2f]/20 focus:border-[#006e2f] transition-colors",
    isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300"
  )
  return isArea
    ? <textarea {...(props as any)} className={cn(className, "resize-none h-20")} />
    : <input {...props} className={className} />
}

export const Select = ({ options, defaultValue, isDark }: { options: string[]; defaultValue?: string } & Dark) => {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(defaultValue ?? options[0])
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={cn("w-full flex items-center justify-between px-3 py-2 text-sm border rounded-lg transition-colors",
        isDark ? "bg-[#1a2235] border-white/10 text-white hover:border-white/20" : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
      )} type="button">
        <span>{selected}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180", isDark ? "text-white/30" : "text-slate-400")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className={cn("absolute z-30 mt-1 w-full border rounded-xl shadow-lg overflow-hidden py-1 max-h-52 overflow-y-auto",
              isDark ? "bg-[#1a2235] border-white/10" : "bg-white border-slate-200"
            )}>
            {options.map(opt => (
              <button key={opt} onClick={() => { setSelected(opt); setOpen(false) }}
                className={cn("w-full text-left px-3 py-2 text-sm",
                  selected === opt
                    ? "bg-[#006e2f]/10 text-[#006e2f] font-semibold"
                    : isDark ? "text-white/70 hover:bg-white/5" : "text-slate-600 hover:bg-slate-50"
                )} type="button">{opt}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

