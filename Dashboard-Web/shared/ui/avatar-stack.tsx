"use client"

import type { TeamMember } from "@/features/teams/models/team"

import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

interface AvatarStackProps {
  members: TeamMember[]
  max?: number
  isDark?: boolean
}

export function AvatarStack({ members, max = 4, isDark = false }: AvatarStackProps) {
  const visible = members.slice(0, max)
  const extra = members.length - max

  return (
    <div className="flex items-center">
      {visible.map((m, i) => (
        <IconTooltip key={m.id || `${m.name}-${i}`} text={m.name} placement="top">
          <div
            className={cn("w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold text-white shrink-0", isDark ? "border-[#151b2d]" : "border-white")}
            style={{
              backgroundColor: m.color,
              marginLeft: i === 0 ? 0 : -8,
              zIndex: visible.length - i,
            }}
          >
            {m.avatar}
          </div>
        </IconTooltip>
      ))}
      {extra > 0 && (
        <div
          className={cn("w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0", isDark ? "border-[#151b2d] bg-[#2e3447] text-[#bccbb9]" : "border-white bg-slate-200 text-slate-500")}
          style={{ marginLeft: -8 }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}
