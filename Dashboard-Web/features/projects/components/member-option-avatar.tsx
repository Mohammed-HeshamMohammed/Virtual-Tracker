"use client"

import { cn } from "@/shared/utils/utils"
import { UserAvatarImage } from "@/shared/ui/user-avatar-image"
import type { ProjectFormOption } from "@/features/projects/api/project-form-api"

function isImageSrc(value: string | undefined): value is string {
  return Boolean(value) && /^(https?:\/\/|data:image\/)/.test(value as string)
}

/** A member's photo in a picker row, falling back to their initials. */
export function MemberOptionAvatar({
  member,
  className,
}: {
  member: Pick<ProjectFormOption, "label" | "initials" | "avatarUrl">
  className?: string
}) {
  const initials = member.initials ?? member.label.slice(0, 2).toUpperCase()
  const base = cn("h-6 w-6 shrink-0 rounded-full", className)

  if (isImageSrc(member.avatarUrl)) {
    return (
      <UserAvatarImage
        src={member.avatarUrl}
        alt={member.label}
        fallbackInitials={initials}
        fallbackColor="#64748b"
        className={cn(base, "object-cover text-[10px]")}
      />
    )
  }
  return (
    <span
      className={cn(
        base,
        "flex items-center justify-center bg-slate-200 text-[10px] font-semibold text-slate-600 dark:bg-[#2e3447] dark:text-[#bccbb9]",
      )}
    >
      {initials}
    </span>
  )
}
