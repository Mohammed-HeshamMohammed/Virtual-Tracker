/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Columns3 } from "lucide-react"
import { AMOUNTS_OWED_TOGGLEABLE_COLUMNS } from "@/features/reports/components/shared/constants"
import type { AmountsOwedColumnKey } from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"

/**
 * Controls the columns this report actually renders. It used to offer member
 * fields (email, job title, tax info, location, ...) that the table has no
 * column for and the endpoint returns no data for, with the checked state held
 * locally so toggling anything did nothing either way.
 */
export function AmountsOwedTableColumnsMenu({
  visible,
  onVisibleChange,
}: {
  visible: Set<AmountsOwedColumnKey>
  onVisibleChange: (next: Set<AmountsOwedColumnKey>) => void
}) {
  const [open, setOpen] = useState(false)

  function toggle(key: AmountsOwedColumnKey) {
    const next = new Set(visible)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onVisibleChange(next)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900",
          open && "bg-slate-50 text-slate-900"
        )}
      >
        <Columns3 className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">Columns</span>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-100 bg-transparent" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full z-110 mt-1 w-56 rounded-lg border border-slate-200 bg-white pb-1 pt-0 shadow-sm"
            >
              <div className="border-b border-slate-100 px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Table columns
              </div>
              {AMOUNTS_OWED_TOGGLEABLE_COLUMNS.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => toggle(column.key)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {visible.has(column.key) ? (
                    <Check className="h-4 w-4 shrink-0 text-slate-600" strokeWidth={2.5} />
                  ) : (
                    <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{column.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
