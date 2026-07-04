"use client"

import { cn } from "@/shared/utils/utils"

type UserAvatarImageProps = {
  src: string
  alt: string
  className?: string
}

/** Remote avatar img — no-referrer for OAuth hotlink blocks; native img (not next/image). */
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
