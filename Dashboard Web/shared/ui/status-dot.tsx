"use client"

import { cn } from "@/shared/utils/utils"
import type { TrackingStatus } from "@/features/members/models/member"

const labels: Record<TrackingStatus, string> = {
  online: "Online",
  idle: "Idle",
  offline: "Offline",
}

export function StatusDot({ status, isDark = false }: { status: TrackingStatus; isDark?: boolean }) {
  const colors: Record<TrackingStatus, string> = {
    online: "bg-sky-400",
    idle: "bg-amber-400",
    offline: isDark ? "bg-[#3d4a3d]" : "bg-slate-300",
  }
  const normalized =
    status === "online" || status === "idle" || status === "offline" ? status : "offline"
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("w-2 h-2 rounded-full", colors[normalized])} />
      <span className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
        {labels[normalized]}
      </span>
    </div>
  )
}
