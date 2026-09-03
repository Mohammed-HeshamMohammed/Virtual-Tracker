"use client"

import { memberAvatarColor } from "@/features/members/utils/build-tree"

export function ReportMemberAvatar({ initials }: { initials: string }) {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: memberAvatarColor(initials, false) }}
    >
      {initials}
    </div>
  )
}
