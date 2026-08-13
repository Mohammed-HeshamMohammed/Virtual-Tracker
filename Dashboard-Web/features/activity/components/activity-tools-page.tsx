"use client"

import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { AgentDownloadChoices } from "@/shared/ui/agent-download-choices"

export function ActivityToolsPage() {
  const { isDark } = useTheme()

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto px-1 py-1">
      <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", isDark ? "text-slate-100" : "text-slate-900")}>
        Tools
      </h1>

      <div
        className={cn(
          "flex flex-col gap-5 rounded-2xl border p-6 shadow-sm transition-all backdrop-blur-xl",
          isDark
            ? "border-slate-800 bg-slate-900/80 shadow-slate-950/20"
            : "border-slate-200/80 bg-white/90 shadow-slate-900/5",
        )}
      >
        <div className="min-w-0">
          <h2 className={cn("text-base font-bold tracking-tight", isDark ? "text-slate-100" : "text-slate-900")}>
            Agent Tracker setup
          </h2>
          <p className={cn("mt-1 text-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-600")}>
            The timer only starts once the Virtual Tracker Agent is running on this computer. Download the
            installer for your OS, install it, sign in, then start tracking from the topbar.
          </p>
        </div>

        <AgentDownloadChoices compact className={isDark ? "" : "[&_a]:border-slate-200 [&_a]:bg-slate-50 [&_a]:text-slate-800 [&_a:hover]:bg-white"} />
      </div>
    </div>
  )
}
