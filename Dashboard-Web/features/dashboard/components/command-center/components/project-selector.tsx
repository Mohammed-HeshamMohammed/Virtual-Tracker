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
        className="flex items-center gap-2.5 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm" type="button"
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${selected.color}`} />
        <span>{selected.name}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-50 overflow-hidden max-h-72 overflow-y-auto"
          >
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => { onSelect(project); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 text-left" type="button"
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${project.color}`} />
                <span className={`flex-1 ${selected.id === project.id ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                  {project.name}
                </span>
                {selected.id === project.id && <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
