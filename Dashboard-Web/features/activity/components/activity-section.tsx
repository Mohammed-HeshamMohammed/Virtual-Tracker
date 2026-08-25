"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"

type ActivitySectionProps = {
  title: string
  description?: string
  /** Optional control rendered at the right of the header row. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Consistent section header + body for Activity sub-pages. */
export function ActivitySection({ title, description, action, children, className }: ActivitySectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          {description ? <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
