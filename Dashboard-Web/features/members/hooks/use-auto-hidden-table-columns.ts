/* eslint-disable react-doctor/exhaustive-deps, react-doctor/js-set-map-lookups */
import { useLayoutEffect, useMemo, useState, type RefObject } from "react"

/** Lowest-priority columns are hidden first when the table is too narrow. */
export const MEMBER_COL_AUTO_HIDE_PRIORITY = [
  "teams",
  "projects",
  "date_added",
  "payment",
  "limits",
  "phone",
  "status",
] as const

export const INVITE_COL_AUTO_HIDE_PRIORITY = [
  "teams",
  "projects",
  "payment",
  "weeklyLimit",
  "status",
] as const

export const MEMBER_NAME_COL_MIN_WIDTH = 300
/** Role is a fixed column — same treatment as Member (never auto-hidden or shrunk). */
export const MEMBER_ROLE_COL_MIN_WIDTH = 148
export const MEMBER_SELECT_COL_WIDTH = 44
export const MEMBER_ACTIONS_COL_WIDTH = 48

export const MEMBER_COL_MIN_WIDTH: Record<string, number> = {
  status: 88,
  projects: 108,
  payment: 96,
  limits: 88,
  date_added: 116,
  teams: 108,
  phone: 120,
}

export const INVITE_COL_MIN_WIDTH: Record<string, number> = {
  email: 240,
  role: 96,
  teams: 108,
  projects: 108,
  payment: 96,
  weeklyLimit: 112,
  status: 120,
}

export function getMembersTableFixedWidth(options: {
  showSelectColumn: boolean
  showActionsColumn: boolean
  includeRoleColumn?: boolean
}): number {
  return (
    (options.showSelectColumn ? MEMBER_SELECT_COL_WIDTH : 0) +
    MEMBER_NAME_COL_MIN_WIDTH +
    (options.includeRoleColumn ? MEMBER_ROLE_COL_MIN_WIDTH : 0) +
    (options.showActionsColumn ? MEMBER_ACTIONS_COL_WIDTH : 0)
  )
}

export function memberTableColWidth(key: string): number {
  if (key === "role") return MEMBER_ROLE_COL_MIN_WIDTH
  return MEMBER_COL_MIN_WIDTH[key] ?? 100
}

export function computeAutoHiddenTableColumns(
  availableWidth: number,
  enabledCols: Set<string>,
  colOrder: string[],
  hidePriority: readonly string[],
  colMinWidths: Record<string, number>,
  fixedWidth: number,
  excludeFromWidthSum: readonly string[] = [],
): Set<string> {
  const available = Math.max(0, availableWidth - 8)
  const orderedEnabled = colOrder.filter((key) => enabledCols.has(key))
  const hidden = new Set<string>()
  const visibleKeys = [...orderedEnabled]

  const totalWidth = (keys: string[]) =>
    fixedWidth +
    keys
      .filter((key) => !excludeFromWidthSum.includes(key))
      .reduce((sum, key) => sum + (colMinWidths[key] ?? 100), 0)

  let width = totalWidth(visibleKeys)

  for (const key of hidePriority) {
    if (width <= available) break
    if (!visibleKeys.includes(key)) continue
    hidden.add(key)
    visibleKeys.splice(visibleKeys.indexOf(key), 1)
    width = totalWidth(visibleKeys)
  }

  return hidden
}

export function getMembersTableMinWidth(
  visibleColKeys: readonly string[],
  options: { showSelectColumn: boolean; showActionsColumn: boolean },
): number {
  const includeRoleColumn = visibleColKeys.includes("role")
  return (
    getMembersTableFixedWidth({ ...options, includeRoleColumn }) +
    visibleColKeys
      .filter((key) => key !== "role")
      .reduce((sum, key) => sum + (MEMBER_COL_MIN_WIDTH[key] ?? 100), 0)
  )
}

const EMPTY_AUTO_HIDDEN_COLS = new Set<string>()

export function useAutoHiddenTableColumns(
  containerRef: RefObject<HTMLElement | null>,
  enabledCols: Set<string>,
  colOrder: string[],
  hidePriority: readonly string[],
  colMinWidths: Record<string, number>,
  fixedWidth: number,
  excludeFromWidthSum: readonly string[] = [],
  enabled = true,
): Set<string> {
  const enabledKey = useMemo(
    () => colOrder.filter((key) => enabledCols.has(key)).join("|"),
    [colOrder, enabledCols],
  )

  const [autoHidden, setAutoHidden] = useState<Set<string>>(() => new Set())

  useLayoutEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return

    const compute = () => {
      const hidden = computeAutoHiddenTableColumns(
        el.clientWidth,
        enabledCols,
        colOrder,
        hidePriority,
        colMinWidths,
        fixedWidth,
        excludeFromWidthSum,
      )

      setAutoHidden((prev) => {
        if (prev.size === hidden.size && [...hidden].every((key) => prev.has(key))) return prev
        return hidden
      })
    }

    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    window.addEventListener("resize", compute)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", compute)
    }
  }, [containerRef, enabledKey, colOrder, hidePriority, colMinWidths, fixedWidth, excludeFromWidthSum, enabledCols, enabled])

  return enabled ? autoHidden : EMPTY_AUTO_HIDDEN_COLS
}
