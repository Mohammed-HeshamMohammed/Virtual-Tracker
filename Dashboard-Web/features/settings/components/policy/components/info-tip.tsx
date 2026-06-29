/* eslint-disable react-doctor/no-chain-state-updates */
"use client"

import { useRef, useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { dashboardTooltipSurfaceClass, DASHBOARD_TOOLTIP_ARROW_TOP_CLASS } from "@/shared/ui/dashboard-tooltip-theme"

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setCoords({ top: r.bottom + 8, left: r.left + r.width / 2 })
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cn("inline-flex shrink-0 rounded-full p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400", className)}
        aria-label="More information"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: "translateX(-50%)",
              zIndex: 200000,
              maxWidth: "min(18rem, calc(100vw - 1rem))",
            }}
            className={dashboardTooltipSurfaceClass(
              "text-center leading-snug pointer-events-none",
            )}
          >
            {text}
            <div
              className={cn(
                "absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent",
                DASHBOARD_TOOLTIP_ARROW_TOP_CLASS,
              )}
              aria-hidden
            />
          </div>,
          document.body
        )}
    </>
  )
}

