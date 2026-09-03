"use client"

import { Avatar } from "@/shared/ui/avatar"
import { memberAvatarColor } from "@/features/members/utils/build-tree"

/** Thin report-specific wrapper around the shared Avatar - same size this
 *  component always rendered (h-7 w-7), now showing a real profile photo
 *  when one is available instead of only ever falling back to colored
 *  initials. */
export function ReportMemberAvatar({ initials, imageUrl }: { initials: string; imageUrl?: string | null }) {
  return (
    <Avatar
      initials={initials}
      color={memberAvatarColor(initials, false)}
      imageUrl={imageUrl ?? undefined}
      size="sm"
    />
  )
}
