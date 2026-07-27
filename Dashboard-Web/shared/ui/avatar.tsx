"use client"

import { cn } from "@/shared/utils/utils"
import { UserAvatarImage } from "@/shared/ui/user-avatar-image"

function isImageSrc(value: string | undefined): boolean {
  if (!value) return false
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image")
}

export function Avatar({
  initials,
  color,
  size = "md",
  isDark = false,
  imageUrl,
  alt,
}: {
  initials: string
  color: string
  size?: "sm" | "md" | "lg" | "xl"
  isDark?: boolean
  /** Profile photo URL when available (Firebase Auth / Storage). */
  imageUrl?: string
  alt?: string
}) {
  const dim =
    size === "sm"
      ? "w-7 h-7 text-[10px]"
      : size === "lg"
        ? "w-10 h-10 text-sm"
        : size === "xl"
          ? "w-24 h-24 text-xl"
          : "w-8 h-8 text-xs"
  const src = imageUrl?.trim() || ""

  if (isImageSrc(src)) {
    return (
      <UserAvatarImage
        src={src}
        alt={alt ?? initials}
        fallbackInitials={initials}
        fallbackColor={color}
        className={cn("shrink-0 rounded-full object-cover", dim)}
      />
    )
  }

  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-bold text-white shrink-0", dim)}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  )
}
