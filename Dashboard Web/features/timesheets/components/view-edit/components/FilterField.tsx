"use client"

import type { ReactNode } from "react"
import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { filterBarEnter } from "@/features/timesheets/components/view-edit/lib/motion"

export function FilterField({
  label,
  children,
  className,
  index = 0,
}: {
  label: string
  children: ReactNode
  className?: string
  index?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.06 + index * 0.04 }}
      className={cn("min-w-0 flex-1 sm:max-w-[220px]", className)}
    >
      <label className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </motion.div>
  )
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <motion.div
      {...filterBarEnter}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm sm:gap-4 sm:p-4"
    >
      {children}
    </motion.div>
  )
}
