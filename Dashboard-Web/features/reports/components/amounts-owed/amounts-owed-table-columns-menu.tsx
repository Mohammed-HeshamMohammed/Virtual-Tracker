/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronRight, Columns3 } from "lucide-react"
import { AMOUNTS_OWED_ABOUT_MEMBER_FIELDS } from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"

const PROJECT_KEY = "project"
const ABOUT_KEY = "about_member"

export function AmountsOwedTableColumnsMenu() {
  const [open, setOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [visible, setVisible] = useState<Set<string>>(() => {
    const s = new Set<string>([PROJECT_KEY, ABOUT_KEY])
    AMOUNTS_OWED_ABOUT_MEMBER_FIELDS.forEach((f) => {
      if (f.defaultVisible) s.add(f.key)
    })
    return s
  })

  function toggle(k: string) {
    setVisible((prev) => {
      const n = new Set(prev)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
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
              <button
                type="button"
                onClick={() => toggle(PROJECT_KEY)}
                className="flex w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Project
              </button>
              <div
                className="relative border-t border-slate-50"
                onMouseEnter={() => setAboutOpen(true)}
                onMouseLeave={() => setAboutOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => toggle(ABOUT_KEY)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {visible.has(ABOUT_KEY) ? (
                      <Check className="h-4 w-4 shrink-0 text-slate-600" strokeWidth={2.5} />
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">About member</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
                <AnimatePresence>
                  {aboutOpen && (
                    <motion.div
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={{ duration: 0.1 }}
                      className="absolute right-full top-0 z-120 mr-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-sm"
                      onMouseEnter={() => setAboutOpen(true)}
                      onMouseLeave={() => setAboutOpen(false)}
                    >
                      <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">
                        About member
                      </div>
                      <div className="max-h-[min(280px,55vh)] overflow-y-auto scrollbar-hide py-0.5">
                        {AMOUNTS_OWED_ABOUT_MEMBER_FIELDS.map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => toggle(f.key)}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {visible.has(f.key) ? (
                              <Check className="h-4 w-4 shrink-0 text-slate-600" strokeWidth={2.5} />
                            ) : (
                              <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                            )}
                            <span className="truncate">{f.label}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

