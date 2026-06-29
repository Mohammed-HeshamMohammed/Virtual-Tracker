import { cn } from "@/shared/utils/utils"

/** Consistent table cell padding; expands vertically when row height is distributed. */
export function peopleTableCellClass(
  base: string,
  distributedRowHeight?: number,
): string {
  return cn(base, distributedRowHeight ? "py-0 align-middle" : "py-3.5 align-middle")
}

export function peopleTableRowStyle(
  distributedRowHeight?: number,
): { height: number; maxHeight: number } | undefined {
  if (!distributedRowHeight) return undefined
  return { height: distributedRowHeight, maxHeight: distributedRowHeight }
}
