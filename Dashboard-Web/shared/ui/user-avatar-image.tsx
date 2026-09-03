"use client"

import { useState, useEffect } from "react"
import { cn } from "@/shared/utils/utils"

type UserAvatarImageProps = {
  src: string
  alt: string
  className?: string
  fallbackInitials?: string
  fallbackColor?: string
}

export function UserAvatarImage({ src, alt, className, fallbackInitials, fallbackColor }: UserAvatarImageProps) {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [src])

  if (hasError && fallbackInitials) {
    return (
      <div
        className={cn("flex items-center justify-center font-bold text-white shrink-0 rounded-full", className)}
        style={{ backgroundColor: fallbackColor || "#6366f1" }}
      >
        {fallbackInitials}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setHasError(true)}
      className={cn(className)}
    />
  )
}

