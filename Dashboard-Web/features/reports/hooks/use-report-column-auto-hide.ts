import { useRef, type RefObject } from "react"
import { useAutoHiddenTableColumns } from "@/features/members/hooks/use-auto-hidden-table-columns"

export function useReportColumnAutoHide<T extends { key: string }>(
  columns: readonly T[],
  options?: {
    enabledCols?: Set<string>
    minWidths?: Record<string, number>
    hidePriority?: readonly string[]
    fixedWidth?: number
  },
): { containerRef: RefObject<HTMLDivElement | null>; hiddenCols: Set<string>; visibleColumns: T[] } {
  const containerRef = useRef<HTMLDivElement>(null)
  const colOrder = columns.map((c) => c.key)
  const enabledCols = options?.enabledCols ?? new Set(colOrder)
  const hidePriority = options?.hidePriority ?? [...colOrder].reverse()
  const minWidths = options?.minWidths ?? {}

  const hiddenCols = useAutoHiddenTableColumns(
    containerRef,
    enabledCols,
    colOrder,
    hidePriority,
    minWidths,
    options?.fixedWidth ?? 0,
  )

  const visibleColumns = columns.filter((c) => enabledCols.has(c.key) && !hiddenCols.has(c.key))
  return { containerRef, hiddenCols, visibleColumns }
}
