"use client"

import { Avatar } from "@/shared/ui/avatar"
import { memberAvatarColor } from "@/features/members/utils/build-tree"

/** Member avatar for the activity pages — a real profile photo when the feed
 *  carries one, colored initials otherwise. Mirrors ReportMemberAvatar. */
export function ActivityMemberAvatar({
  initials,
  imageUrl,
  size = "lg",
}: {
  initials: string
  imageUrl?: string | null
  size?: "sm" | "md" | "lg" | "xl"
}) {
  return (
    <Avatar
      initials={initials}
      color={memberAvatarColor(initials, false)}
      imageUrl={imageUrl ?? undefined}
      size={size}
    />
  )
}
