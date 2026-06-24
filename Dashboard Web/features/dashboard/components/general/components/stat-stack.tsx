"use client"

import { type ReactNode } from "react"
import {
  DASHBOARD_GRID_GAP_PX,
  DASHBOARD_PANEL_HEIGHT_PX,
  DASHBOARD_STAT_SLOT_PX,
} from "@/features/dashboard/components/general/constants"

export function StatStack({ children }: { children: ReactNode }) {
  return (
    <div
      className="col-span-6 min-h-0 sm:col-span-4 lg:col-span-3 xl:col-span-2"
      style={{ gridRow: "span 2", height: DASHBOARD_PANEL_HEIGHT_PX }}
    >
      <div className="flex h-full min-h-0 flex-col" style={{ gap: DASHBOARD_GRID_GAP_PX }}>
        {children}
      </div>
    </div>
  )
}

export function StatSlot({
  stackSize,
  children,
}: {
  stackSize: number
  children: ReactNode
}) {
  const slotHeight = stackSize === 1 ? DASHBOARD_PANEL_HEIGHT_PX : DASHBOARD_STAT_SLOT_PX

  return (
    <div
      className="min-h-0 shrink-0"
      style={{ height: slotHeight, minHeight: slotHeight, maxHeight: slotHeight }}
    >
      <div className="h-full min-h-0">{children}</div>
    </div>
  )
}

export function PanelBlock({ children }: { children: ReactNode }) {
  return (
    <div
      className="col-span-12 min-h-0 lg:col-span-6"
      style={{ gridRow: "span 2", height: DASHBOARD_PANEL_HEIGHT_PX }}
    >
      <div className="h-full min-h-0">{children}</div>
    </div>
  )
}
