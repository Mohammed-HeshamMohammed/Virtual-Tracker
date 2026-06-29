"use client"

import { AVATAR_COLORS } from "@/features/reports/components/shared/constants"

export function ReportMemberAvatar({ initials }: { initials: string }) {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: AVATAR_COLORS[initials] ?? "#94a3b8" }}
    >
      {initials}
    </div>
  )
}

