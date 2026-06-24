"use client"

import { cn } from "@/shared/utils/utils"

type UserAvatarImageProps = {
  src: string
  alt: string
  className?: string
}

/**
 * OAuth avatars (e.g. Google) often block hotlinking when a Referer is sent.
 * `referrerPolicy="no-referrer"` matches Firebase / Google guidance for profile photos.
 * Uses a native `img` so Firebase Storage and other remote URLs work without Next.js image config.
 */
export function UserAvatarImage({ src, alt, className }: UserAvatarImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      className={cn(className)}
    />
  )
}
