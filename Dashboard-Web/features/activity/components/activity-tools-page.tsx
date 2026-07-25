"use client"

import { Download, Monitor } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"

const RELEASES_URL = "https://github.com/Mohammed-HeshamMohammed/Virtual-Tracker/releases/latest"

export function ActivityToolsPage() {
  const { isDark } = useTheme()

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto px-1 py-1")}>
      <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
        Tools
      </h1>

      <div
        className={cn(
          "flex flex-col items-start gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center",
          isDark ? "border-white/10 bg-[#171d2c]" : "border-slate-200 bg-white",
        )}
      >
        <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl", isDark ? "bg-[#1a2130]" : "bg-slate-100")}>
          <Monitor className={cn("h-7 w-7", isDark ? "text-[#4be277]" : "text-green-600")} />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
            Agent Tracker setup
          </h2>
          <p className={cn("mt-1 text-sm", isDark ? "text-[#8891ab]" : "text-slate-500")}>
            The timer only starts once the Virtual Tracker Agent is running on this computer. Download and
            install it, sign in, then start tracking from the topbar.
          </p>
        </div>

        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-600/20 transition-transform hover:scale-[1.02] active:scale-95"
          style={{ background: "linear-gradient(135deg,#006e2f,#22c55e)" }}
        >
          <Download className="h-4 w-4" />
          Download
        </a>
      </div>
    </div>
  )
}
