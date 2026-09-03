import { useRef, type RefObject } from "react"
import { useAutoHiddenTableColumns } from "@/features/members/hooks/use-auto-hidden-table-columns"

/**
 * Drop-in width-based column auto-hide for a report table - the same
 * behavior the Members/Projects/Clients/Tasks/Teams tables already use
 * (useAutoHiddenTableColumns, reused as-is: its logic was never actually
 * member-specific). Lower-priority columns hide first as the table's own
 * card narrows, and come back as space allows, instead of the table
 * spilling into a wide horizontal scrollbar with columns the viewport had
 * room to show squeezed off past the fold.
 *
 * No per-report config is required beyond the column list: hidePriority
 * defaults to reverse declaration order (rightmost/most-supplementary
 * column hidden first), which matches how most of these tables are already
 * laid out - an identity/date column first, detail columns after it.
 */
export function useReportColumnAutoHide<T extends { key: string }>(
  columns: readonly T[],
  options?: {
    /** Columns the user has separately toggled on/off (a column picker).
     *  Omit when every column in `columns` is always a candidate. */
    enabledCols?: Set<string>
    minWidths?: Record<string, number>
    /** Least-important first. Defaults to reverse(columns). */
    hidePriority?: readonly string[]
    /** Width already spoken for by fixed columns (an identity/date column,
     *  row actions) that aren't in `columns` at all. */
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
