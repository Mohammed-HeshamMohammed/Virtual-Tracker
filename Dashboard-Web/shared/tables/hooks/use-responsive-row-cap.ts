import { useEffect, useState } from "react"

export type RowCapBreakpoint = { minWidth: number; maxRows: number }

function rowCapForWidth(width: number, breakpoints: readonly RowCapBreakpoint[]): number {
  const sorted = breakpoints.toSorted((a, b) => b.minWidth - a.minWidth)
  for (const bp of sorted) {
    if (width >= bp.minWidth) return bp.maxRows
  }
  return sorted[sorted.length - 1]?.maxRows ?? 5
}

export function useResponsiveRowCap(breakpoints: readonly RowCapBreakpoint[]): number {
  const [cap, setCap] = useState(() =>
    typeof window !== "undefined" ? rowCapForWidth(window.innerWidth, breakpoints) : breakpoints[breakpoints.length - 1]?.maxRows ?? 5,
  )

  useEffect(() => {
    const update = () => setCap(rowCapForWidth(window.innerWidth, breakpoints))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [breakpoints])

  return cap
}
