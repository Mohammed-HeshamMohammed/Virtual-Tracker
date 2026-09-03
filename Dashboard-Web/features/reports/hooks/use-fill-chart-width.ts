import { useEffect, useRef, useState } from "react"

/**
 * Fills a chart's real available width instead of a hardcoded viewBox
 * guess: on a wide card, `slotW` (each day's column) grows to use the
 * leftover space; adding days shrinks `slotW` back down, but never past
 * `minSlot`. Once minSlot is hit, `vbW` (the SVG's own pixel width)
 * exceeds the container's, and the caller's `overflow-x-auto` wrapper
 * scrolls on its own - no extra scroll logic needed here, just an honest
 * measured width instead of a made-up one.
 */
export function useFillChartWidth({
  pointCount,
  minSlot,
  padL,
  padR,
  fallbackWidth = 700,
}: {
  pointCount: number
  minSlot: number
  padL: number
  padR: number
  fallbackWidth?: number
}): { containerRef: React.RefObject<HTMLDivElement | null>; slotW: number; vbW: number } {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(fallbackWidth)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = (): void => setContainerW(el.clientWidth || fallbackWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // Belt-and-suspenders alongside ResizeObserver, matching this codebase's
    // own useDistributedRowHeight - a window-level resize (sidebar toggle,
    // browser zoom) that doesn't itself resize this element's box.
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
    // eslint-disable-next-line react-doctor/exhaustive-deps
  }, [])

  const n = Math.max(pointCount, 1)
  const slotW = Math.max(minSlot, (containerW - padL - padR) / n)
  const vbW = padL + n * slotW + padR

  return { containerRef, slotW, vbW }
}
