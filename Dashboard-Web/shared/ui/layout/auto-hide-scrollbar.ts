import { useCallback, useRef } from "react"

/** How long the scrollbar stays after the last scroll or nudge at the edge. */
export const HIDE_AFTER_MS = 1000
/** How close to the pane's right edge the pointer has to be to call the scrollbar up. */
export const EDGE_PX = 16

/**
 * A scrollbar that is only there while it is being used: it appears on scroll, or when the
 * pointer goes to the right edge where it lives (so it can still be grabbed), and goes again
 * shortly after. The styling reads `data-scroll-active`; this only flips it.
 */
export function attachAutoHideScrollbar(el: HTMLElement, hideAfterMs = HIDE_AFTER_MS, edgePx = EDGE_PX): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const show = () => {
    el.dataset.scrollActive = "true"
    clearTimeout(timer)
    timer = setTimeout(() => {
      delete el.dataset.scrollActive
    }, hideAfterMs)
  }
  const nearEdge = (event: PointerEvent) => event.clientX >= el.getBoundingClientRect().right - edgePx

  const onMove = (event: PointerEvent) => {
    if (nearEdge(event)) show()
  }

  el.addEventListener("scroll", show, { passive: true })
  el.addEventListener("pointermove", onMove, { passive: true })
  return () => {
    clearTimeout(timer)
    el.removeEventListener("scroll", show)
    el.removeEventListener("pointermove", onMove)
    delete el.dataset.scrollActive
  }
}

/** A callback ref, because the scrolling element is not there until the shell has loaded. */
export function useAutoHideScrollbar(): (node: HTMLElement | null) => void {
  const detach = useRef<(() => void) | undefined>(undefined)
  return useCallback((node: HTMLElement | null) => {
    detach.current?.()
    detach.current = node ? attachAutoHideScrollbar(node) : undefined
  }, [])
}
