import { useEffect, useRef, useState } from "react"

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
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
    // eslint-disable-next-line react-doctor/exhaustive-deps
  }, [])

  const n = Math.max(pointCount, 1)
  const slotW = Math.max(minSlot, Math.floor((containerW - padL - padR) / n))
  const vbW = padL + n * slotW + padR

  return { containerRef, slotW, vbW }
}
