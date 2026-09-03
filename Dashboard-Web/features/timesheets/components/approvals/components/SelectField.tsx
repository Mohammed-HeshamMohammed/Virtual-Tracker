"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

interface SelectFieldProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}

const OPTION_ROW_HEIGHT = 40
const MENU_PADDING = 8

export function SelectField<T extends string>({ value, onChange, options }: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const label = options.find((o) => o.value === value)?.label ?? "Select"
  // Portalled to the body rather than positioned inside this field: the
  // menu used to be absolute within whatever contained it, so any dialog
  // with overflow-hidden on its panel (the timesheet approvals setup one)
  // simply cut the list off at the panel edge. Going through the shared
  // floating-menu positioner also flips the menu above the trigger when
  // there is more room up there.
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    options.length * OPTION_ROW_HEIGHT + MENU_PADDING,
    options.length,
  )

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (triggerRef.current) syncPosition()
          setOpen((v) => !v)
        }}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
      >
        <span>{label}</span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && menuStyle && (
              <div className={cn("fixed inset-0 pointer-events-none", FLOATING_MENU_Z_CLASS)}>
                <div className="absolute inset-0 pointer-events-auto" aria-hidden onMouseDown={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  {...{ [FLOATING_MENU_ATTR]: "" }}
                  className="pointer-events-auto fixed overflow-y-auto custom-scrollbar bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg py-1"
                  style={{
                    top: menuStyle.top,
                    left: menuStyle.left,
                    width: menuStyle.width,
                    maxHeight: menuStyle.maxHeight,
                  }}
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
                        "w-full flex items-center justify-between px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors",
                        opt.value === value && "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {opt.label}
                      {opt.value === value && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
