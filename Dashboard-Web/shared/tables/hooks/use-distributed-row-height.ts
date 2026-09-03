import { useEffect, useState, type RefObject } from "react"
import { distributeRowHeight, measureTbodyArea } from "@/shared/tables/utils/table-layout"

export function useDistributedRowHeight(
  containerRef: RefObject<HTMLElement | null>,
  visibleRowCount: number,
): number | undefined {
  const [rowHeight, setRowHeight] = useState<number | undefined>(undefined)

  if (visibleRowCount < 1 && rowHeight !== undefined) {
    setRowHeight(undefined)
  }

  useEffect(() => {
    if (visibleRowCount < 1) return

    const el = containerRef.current
    if (!el) return

    const measure = (): void => {
      const { tbodyArea } = measureTbodyArea(el, visibleRowCount)
      const next = distributeRowHeight(tbodyArea, visibleRowCount)
      setRowHeight((prev) => (prev === next ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [containerRef, visibleRowCount])

  return rowHeight
}
