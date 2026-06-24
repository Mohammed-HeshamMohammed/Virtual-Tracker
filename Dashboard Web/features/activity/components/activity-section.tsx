"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"

type ActivitySectionProps = {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

/** Consistent section header + body for Activity sub-pages. */
export function ActivitySection({ title, description, children, className }: ActivitySectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
