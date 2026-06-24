"use client"

import { useCallback, useLayoutEffect, useState, type RefObject } from "react"

export type FloatingMenuStyle = {
  top: number
  left: number
  width: number
  maxHeight: number
}

const GAP = 4
const DEFAULT_ESTIMATED_HEIGHT = 280
const MIN_MENU_HEIGHT = 80
const OPTION_ROW_HEIGHT = 40
const MENU_PADDING = 8

function estimateContentHeight(itemCount: number, estimatedHeight: number): number {
  if (itemCount > 0) return itemCount * OPTION_ROW_HEIGHT + MENU_PADDING
  return estimatedHeight
}

function computeMenuStyle(
  el: HTMLElement,
  estimatedHeight: number,
  itemCount = 0,
  menuMinWidth = 0,
): FloatingMenuStyle {
  const rect = el.getBoundingClientRect()
  const contentHeight = estimateContentHeight(itemCount, estimatedHeight)
  const spaceBelow = window.innerHeight - rect.bottom - GAP
  const spaceAbove = rect.top - GAP

  const fitsBelow = spaceBelow >= contentHeight
  const openUpward = !fitsBelow && spaceAbove > spaceBelow

  const maxHeight = Math.max(
    MIN_MENU_HEIGHT,
    Math.min(estimatedHeight, openUpward ? spaceAbove - 8 : spaceBelow - 8),
  )

  const menuHeight = Math.min(contentHeight, maxHeight)
  const top = openUpward ? rect.top - menuHeight - GAP : rect.bottom + GAP

  return {
    top,
    left: rect.left,
    width: Math.max(rect.width, menuMinWidth),
    maxHeight,
  }
}

export function useFloatingMenuPosition(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
  itemCount = 0,
  menuMinWidth = 0,
): { style: FloatingMenuStyle | null; syncPosition: () => void } {
  const [style, setStyle] = useState<FloatingMenuStyle | null>(null)

  const syncPosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    setStyle(computeMenuStyle(el, estimatedHeight, itemCount, menuMinWidth))
  }, [triggerRef, estimatedHeight, itemCount, menuMinWidth])

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }

    syncPosition()
    window.addEventListener("scroll", syncPosition, true)
    window.addEventListener("resize", syncPosition)
    return () => {
      window.removeEventListener("scroll", syncPosition, true)
      window.removeEventListener("resize", syncPosition)
    }
  }, [open, syncPosition])

  return { style, syncPosition }
}
