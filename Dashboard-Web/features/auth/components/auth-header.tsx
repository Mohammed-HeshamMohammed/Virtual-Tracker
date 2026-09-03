"use client"

import React, { useState } from "react"
import { ArrowRight, Globe } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { AuthThemeToggle } from "@/features/auth/components/auth-theme-toggle"
import Image from "next/image"

interface AuthHeaderProps {
  isDark: boolean
  onRequestAccess: () => void
}

export function AuthHeader({ isDark, onRequestAccess }: AuthHeaderProps) {
  const u = getAuthStyles(isDark)
  const [wipHover, setWipHover] = useState(false)
  const [wipClick, setWipClick] = useState(false)

  return (
    <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="flex items-center gap-2.5">
        <div className="relative h-9 w-9 shrink-0">
          <Image
            src={isDark ? "/stopwatch-green.png" : "/stopwatch-black.png"}
            alt="Virtual Tracker"
            className="h-9 w-9 object-contain"
            width={36}
            height={36}
          />
        </div>
        <div>
          <h1 className={cn("text-[1.1rem] font-black leading-none tracking-tight", u.brandTitle)}>
            Virtual Tracker
          </h1>
          <button
            type="button"
            className={cn(
              "mt-0.5 inline-flex items-center gap-0.5 text-[0.68rem] font-medium leading-tight transition-colors duration-150",
              u.brandLink
            )}
          >
            virtualtracker.com
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <AuthThemeToggle />
        <div
          className="relative"
          onMouseEnter={() => setWipHover(true)}
          onMouseLeave={() => setWipHover(false)}
        >
          <button
            type="button"
            aria-expanded={wipHover || wipClick}
            aria-haspopup="true"
            className={cn("rounded-full p-2 transition-all duration-150", u.globeBtn)}
            onClick={() => setWipClick((c) => !c)}
          >
            <Globe className="h-5 w-5 sm:h-5 sm:w-5" strokeWidth={1.75} />
          </button>
          {wipHover || wipClick ? (
            <div
              role="tooltip"
              className={cn(
                "absolute right-0 top-full z-70 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-xl px-3.5 py-3 text-left text-xs leading-relaxed",
                u.wipPopover
              )}
            >
              Translation is still in progress. Only English is available right now.
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onRequestAccess}
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm transition-all duration-200 sm:px-5",
            u.requestAccess
          )}
        >
          Request access
        </button>
      </div>
    </header>
  )
}
