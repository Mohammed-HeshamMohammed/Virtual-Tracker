/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"

interface ProjectSelectorProps {
  projects: ProjectData[]
  selected: ProjectData
  onSelect: (p: ProjectData) => void
}

export function ProjectSelector({
  projects,
  selected,
  onSelect,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 px-4 py-2 bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all shadow-sm backdrop-blur-xl" type="button"
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${selected.color}`} />
        <span>{selected.name}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full mt-2 w-56 bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-xl border border-slate-200/80 dark:border-slate-800 py-1.5 z-50 overflow-hidden max-h-72 overflow-y-auto backdrop-blur-xl"
          >
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => { onSelect(project); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-left" type="button"
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${project.color}`} />
                <span className={`flex-1 ${selected.id === project.id ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-300"}`}>
                  {project.name}
                </span>
                {selected.id === project.id && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
