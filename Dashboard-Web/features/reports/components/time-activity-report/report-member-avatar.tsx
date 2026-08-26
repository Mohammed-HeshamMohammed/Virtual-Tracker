"use client"

import { memberAvatarColor } from "@/features/members/utils/build-tree"

/**
 * Colour is derived from the initials so every member gets a stable, distinct
 * one. This used to look up a six-entry map keyed by specific initials (SJ,
 * MC, ED, ...) left over from mock data, so real members almost always fell
 * through to the same grey.
 */
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
