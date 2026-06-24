"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { THEME_OPTIONS } from "@/shared/ui/shared/constants"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

export function AuthThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, isDark } = useTheme()
  const styles = getAuthStyles(isDark)

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border p-0.5",
        isDark ? "border-[#3d4a3d]/40 bg-[#191f31]/80" : "border-[#cbc3d7]/40 bg-white/80",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = theme === option.value
        return (
          <IconTooltip key={option.value} text={option.label} placement="bottom">
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={active}
              onClick={() => setTheme(option.value)}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                active
                  ? isDark
                    ? "bg-[#151b2d] text-[#4be277] shadow-sm"
                    : "bg-[#f0f4f8] text-[#6b38d4] shadow-sm"
                  : isDark
                    ? "text-[#bccbb9] hover:text-[#dce1fb]"
                    : "text-slate-500 hover:text-slate-700",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </IconTooltip>
        )
      })}
    </div>
  )
}
