import { cn } from "@/shared/utils/utils"

export const DASHBOARD_TOOLTIP_SURFACE_CLASS =
  "bg-[#171c1f] text-white text-xs font-semibold leading-snug shadow-lg"

export const DASHBOARD_TOOLTIP_ARROW_TOP_CLASS = "border-b-[#171c1f]"

export const DASHBOARD_TOOLTIP_ARROW_BOTTOM_CLASS = "border-t-[#171c1f]"

export const DASHBOARD_TOOLTIP_ARROW_LEFT_CLASS = "border-r-[#171c1f]"

export const DASHBOARD_TOOLTIP_ARROW_RIGHT_CLASS = "border-l-[#171c1f]"

export function dashboardTooltipSurfaceClass(className?: string): string {
  return cn(
    "pointer-events-none z-50 rounded-lg px-3 py-1.5",
    DASHBOARD_TOOLTIP_SURFACE_CLASS,
    className,
  )
}
