/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import {
  DASHBOARD_TOOLTIP_ARROW_BOTTOM_CLASS,
  dashboardTooltipSurfaceClass,
} from "@/shared/ui/dashboard-tooltip-theme"

interface TooltipProps {
  text: string
  children: React.ReactNode
  className?: string
}

export function Tooltip({ text, children, className }: TooltipProps) {
  const [show, setShow] = useState(false)

  return (
    <div
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            role="tooltip"
            className={dashboardTooltipSurfaceClass(
              "absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 text-center leading-relaxed",
            )}
          >
            {text}
            <div
              className={cn(
                "absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent",
                DASHBOARD_TOOLTIP_ARROW_BOTTOM_CLASS,
              )}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
