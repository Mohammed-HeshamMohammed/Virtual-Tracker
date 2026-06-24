export const TABLE_MIN_ROW_HEIGHT_PX = 52
export const TABLE_FALLBACK_THEAD_HEIGHT_PX = 44
const TABLE_LAYOUT_SAFETY_PX = 4

/** Re-exported from ui-config for table layout helpers. */
export const TABLE_MIN_VISIBLE_ROWS = 4

export function measureTbodyArea(
  container: HTMLElement,
  visibleRowCount = 1,
): { containerHeight: number; theadHeight: number; tbodyArea: number } {
  const containerHeight = container.getBoundingClientRect().height
  const thead = container.querySelector("thead")
  const theadHeight = thead?.getBoundingClientRect().height ?? TABLE_FALLBACK_THEAD_HEIGHT_PX
  const borderFudge = Math.max(0, visibleRowCount - 1)
  const tbodyArea = Math.max(0, containerHeight - theadHeight - borderFudge)
  return { containerHeight, theadHeight, tbodyArea }
}

export function rowsThatFit(tbodyArea: number, fallbackRows = TABLE_MIN_VISIBLE_ROWS): number {
  const safeArea = Math.max(0, tbodyArea - TABLE_LAYOUT_SAFETY_PX)
  const fitted = Math.floor(safeArea / TABLE_MIN_ROW_HEIGHT_PX)
  return fitted > 0 ? fitted : fallbackRows
}

export function distributeRowHeight(tbodyArea: number, visibleRowCount: number): number | undefined {
  if (visibleRowCount < 1 || tbodyArea < 1) return undefined
  const height = tbodyArea / visibleRowCount
  return height >= TABLE_MIN_ROW_HEIGHT_PX ? height : undefined
}
