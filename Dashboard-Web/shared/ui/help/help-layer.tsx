"use client"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { isHelpMode, useHelpMode } from "@/shared/ui/help/help-mode"
import { HELP_SELECTOR, helpTextOf, placeCallout } from "@/shared/ui/help/help-geometry"

const SHOW_DELAY_MS = 120
const SPOTLIGHT_PAD = 4

type Shown = { text: string; rect: DOMRect }

/**
 * The dashboard's help mode: pressing the topbar "?" outlines everything that explains
 * itself, dims the page and lights whatever is hovered with a callout pointing at it.
 * Clicks do nothing while it is on, so exploring cannot change anything. Outside help
 * mode this does nothing at all - the dashboard's own tooltips are left alone.
 */
export function HelpLayer() {
  const helping = useHelpMode()
  const [shown, setShown] = useState<Shown | null>(null)
  const [placed, setPlaced] = useState<ReturnType<typeof placeCallout> | null>(null)
  const calloutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: number | undefined
    let current: Element | null = null

    const hide = () => {
      window.clearTimeout(timer)
      current = null
      setShown(null)
      setPlaced(null)
    }
    const show = (target: Element | null) => {
      if (target === current) return
      hide()
      const text = target ? helpTextOf(target) : ""
      if (!target || !text) return
      current = target
      timer = window.setTimeout(() => {
        if (target.isConnected) setShown({ text, rect: target.getBoundingClientRect() })
      }, SHOW_DELAY_MS)
    }
    const onOver = (event: Event) => {
      if (!isHelpMode()) return
      show(event.target instanceof Element ? event.target.closest(HELP_SELECTOR) : null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide()
    }
    // The help button is the way out, so it is the one thing that still works.
    const block = (event: Event) => {
      if (!isHelpMode()) return
      if (event.target instanceof Element && event.target.closest("[data-help-toggle]")) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onLeaveWindow = (event: MouseEvent) => {
      if (!event.relatedTarget) hide()
    }

    document.addEventListener("mouseover", onOver)
    document.addEventListener("mouseout", onLeaveWindow)
    document.addEventListener("pointerdown", hide, true)
    document.addEventListener("click", block, true)
    document.addEventListener("submit", block, true)
    document.addEventListener("keydown", onKey)
    document.addEventListener("scroll", hide, true)
    window.addEventListener("blur", hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("mouseover", onOver)
      document.removeEventListener("mouseout", onLeaveWindow)
      document.removeEventListener("pointerdown", hide, true)
      document.removeEventListener("click", block, true)
      document.removeEventListener("submit", block, true)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("scroll", hide, true)
      window.removeEventListener("blur", hide)
    }
  }, [])

  useEffect(() => {
    setShown(null)
    setPlaced(null)
  }, [helping])

  useLayoutEffect(() => {
    if (!shown || !calloutRef.current) return
    const { offsetWidth, offsetHeight } = calloutRef.current
    setPlaced(
      placeCallout(shown.rect, { width: offsetWidth, height: offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    )
  }, [shown])

  if (!helping) return null
  return (
    <>
      <div className="help-mode-pill" role="status">
        Help mode: hover anything to see what it is for. Press the ? button to leave.
      </div>
      {shown ? (
        <>
          <div
            className="help-spotlight"
            style={{
              left: shown.rect.left - SPOTLIGHT_PAD,
              top: shown.rect.top - SPOTLIGHT_PAD,
              width: shown.rect.width + SPOTLIGHT_PAD * 2,
              height: shown.rect.height + SPOTLIGHT_PAD * 2,
            }}
          />
          <div
            ref={calloutRef}
            className={`help-callout ${placed?.below === false ? "is-above" : "is-below"}`}
            role="tooltip"
            style={
              {
                left: placed?.left ?? 0,
                top: placed?.top ?? 0,
                visibility: placed ? "visible" : "hidden",
                "--arrow-x": `${placed?.arrow ?? 0}px`,
              } as CSSProperties
            }
          >
            {shown.text}
          </div>
        </>
      ) : null}
    </>
  )
}
