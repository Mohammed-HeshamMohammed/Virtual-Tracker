"use client"

import { Download, Monitor } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"

const RELEASES_URL = "https://github.com/Mohammed-HeshamMohammed/Virtual-Tracker/releases/latest"

export function DownloadAgentPage() {
  const { isDark } = useTheme()

  return (
    <div className={cn("flex h-full min-h-0 w-full items-center justify-center", isDark ? "bg-[#101417]" : "bg-slate-50/40")}>
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-6 py-10 text-center">
        <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl", isDark ? "bg-[#1a2130]" : "bg-slate-100")}>
          <Monitor className={cn("h-8 w-8", isDark ? "text-[#4be277]" : "text-green-600")} />
        </div>

        <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
          Virtual Tracker Agent required
        </h1>

        <p className={cn("text-sm", isDark ? "text-[#8891ab]" : "text-slate-500")}>
          The timer only starts once the Virtual Tracker Agent is running on this computer. Download and
          install it, sign in, then come back and press Start again.
        </p>

        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-600/20 transition-transform hover:scale-[1.02] active:scale-95"
          style={{ background: "linear-gradient(135deg,#006e2f,#22c55e)" }}
        >
          <Download className="h-4 w-4" />
          Download the Agent
        </a>

        <p className={cn("text-xs", isDark ? "text-[#8891ab]" : "text-slate-400")}>
          Windows, macOS and Linux builds are available on the releases page.
        </p>
      </div>
    </div>
  )
}
