"use client"

import { useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import {
  DASHBOARD_TOOLTIP_ARROW_BOTTOM_CLASS,
  DASHBOARD_TOOLTIP_ARROW_LEFT_CLASS,
  DASHBOARD_TOOLTIP_ARROW_RIGHT_CLASS,
  DASHBOARD_TOOLTIP_ARROW_TOP_CLASS,
  dashboardTooltipSurfaceClass,
} from "@/shared/ui/dashboard-tooltip-theme"

type TooltipPlacement = "top" | "bottom" | "left" | "right"

function tooltipPositionClass(placement: TooltipPlacement, multiline: boolean): string {
  switch (placement) {
    case "top":
      return cn("bottom-full left-1/2 mb-2 -translate-x-1/2", multiline ? "w-52 text-center leading-relaxed" : "whitespace-nowrap")
    case "left":
      return cn("right-full top-1/2 mr-2 -translate-y-1/2", multiline ? "w-52 text-center leading-relaxed" : "whitespace-nowrap")
    case "right":
      return cn("left-full top-1/2 ml-2 -translate-y-1/2", multiline ? "w-52 text-center leading-relaxed" : "whitespace-nowrap")
    case "bottom":
    default:
      return cn("top-full left-1/2 mt-2 -translate-x-1/2", multiline ? "w-52 text-center leading-relaxed" : "whitespace-nowrap")
  }
}

function tooltipMotionOffset(placement: TooltipPlacement): number {
  if (placement === "top") return 4
  if (placement === "bottom") return -4
  if (placement === "left") return 4
  return -4
}

function tooltipArrowClass(placement: TooltipPlacement): string {
  switch (placement) {
    case "top":
      return cn("top-full left-1/2 -translate-x-1/2", DASHBOARD_TOOLTIP_ARROW_BOTTOM_CLASS)
    case "left":
      return cn("left-full top-1/2 -translate-y-1/2", DASHBOARD_TOOLTIP_ARROW_RIGHT_CLASS)
    case "right":
      return cn("right-full top-1/2 -translate-y-1/2", DASHBOARD_TOOLTIP_ARROW_LEFT_CLASS)
    case "bottom":
    default:
      return cn("bottom-full left-1/2 -translate-x-1/2", DASHBOARD_TOOLTIP_ARROW_TOP_CLASS)
  }
}

export function IconTooltip({
  text,
  children,
  className,
  placement = "bottom",
  multiline = false,
}: {
  text: string
  children: ReactNode
  isDark?: boolean
  className?: string
  placement?: TooltipPlacement
  multiline?: boolean
}) {
  const [show, setShow] = useState(false)
  const motionOffset = tooltipMotionOffset(placement)

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <AnimatePresence>
        {show ? (
          <motion.div
            initial={{ opacity: 0, y: placement === "left" || placement === "right" ? 0 : motionOffset, x: placement === "left" || placement === "right" ? motionOffset : 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: placement === "left" || placement === "right" ? 0 : motionOffset, x: placement === "left" || placement === "right" ? motionOffset : 0 }}
            transition={{ duration: 0.12 }}
            role="tooltip"
            className={dashboardTooltipSurfaceClass(
              cn("absolute", tooltipPositionClass(placement, multiline)),
            )}
          >
            <div className={cn("absolute border-4 border-transparent", tooltipArrowClass(placement))} />
            {text}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
