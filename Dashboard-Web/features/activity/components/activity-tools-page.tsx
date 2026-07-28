"use client"

import { Download, Monitor } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"

const DOWNLOAD_URL = "/downloads/VirtualTrackerAgent-setup.exe"

export function ActivityToolsPage() {
  const { isDark } = useTheme()

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto px-1 py-1">
      <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", isDark ? "text-slate-100" : "text-slate-900")}>
        Tools
      </h1>

      <div
        className={cn(
          "flex flex-col items-start gap-5 rounded-2xl border p-6 sm:flex-row sm:items-center shadow-sm transition-all backdrop-blur-xl",
          isDark
            ? "border-slate-800 bg-slate-900/80 shadow-slate-950/20"
            : "border-slate-200/80 bg-white/90 shadow-slate-900/5",
        )}
      >
        <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-inner", isDark ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-emerald-200 bg-emerald-50 text-emerald-600")}>
          <Monitor className="h-7 w-7" />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className={cn("text-base font-bold tracking-tight", isDark ? "text-slate-100" : "text-slate-900")}>
            Agent Tracker setup
          </h2>
          <p className={cn("mt-1 text-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-600")}>
            The timer only starts once the Virtual Tracker Agent is running on this computer. Download and
            install it, sign in, then start tracking from the topbar.
          </p>
        </div>

        <a
          href={DOWNLOAD_URL}
          download
          className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:scale-[1.02] hover:shadow-emerald-600/35 active:scale-95 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400"
        >
          <Download className="h-4 w-4" />
          Download
        </a>
      </div>
    </div>
  )
}
