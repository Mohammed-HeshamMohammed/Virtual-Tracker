"use client"

import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function IntegrationConnectCard({
  name,
  logo,
  href = "#",
  className,
}: {
  name: string
  logo: ReactNode
  href?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border overflow-hidden bg-white transition-shadow hover:shadow-md",
        "border-slate-200 dark:border-white/10 dark:bg-[#151b2d]",
        className
      )}
    >
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 min-h-[140px]">
        <div className="h-12 w-12 flex items-center justify-center shrink-0">{logo}</div>
        <span className="text-sm font-semibold text-slate-800 dark:text-[#dce1fb] text-center">{name}</span>
      </div>
      <div
        className={cn(
          "flex items-center justify-center py-3 border-t",
          "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-[#191f31]/80"
        )}
      >
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Connect
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  )
}

export function PreferredBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        "bg-white text-slate-600 border-slate-200 shadow-sm",
        "dark:bg-[#191f31] dark:text-[#bccbb9] dark:border-white/10",
        className
      )}
    >
      <span className="text-red-500" aria-hidden>
        ♥
      </span>
      Preferred
    </span>
  )
}

