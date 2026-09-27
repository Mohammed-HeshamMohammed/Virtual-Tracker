"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { setHelpMode, useHelpMode } from "@/shared/ui/help/help-mode"
import { placeCallout, type Placed } from "@/shared/ui/help/help-geometry"
import { collectTourSteps, type Step } from "@/shared/ui/help/help-collect"

const SPOTLIGHT_PAD = 4
const OWN_UI = ".help-tour, [data-help-toggle]"

/**
 * The dashboard's guided tour, behind the topbar "?": it walks through everything on screen
 * one thing at a time - sidebar, then top bar, then the page - dimming the rest and pointing
 * at each. Esc or Skip ends it, and nothing under it can be clicked while it runs.
 */
export function HelpLayer() {
  const touring = useHelpMode()
  const [steps, setSteps] = useState<Step[]>([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const calloutRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  const finish = useCallback(() => setHelpMode(false), [])
  const step = useCallback(
    (by: number) => {
      const to = index + by
      if (to >= steps.length) finish()
      else setIndex(Math.max(0, to))
    },
    [index, steps.length, finish],
  )

  useEffect(() => {
    if (!touring) {
      setSteps([])
      setIndex(0)
      setRect(null)
      setPlaced(null)
      return
    }
    const found = collectTourSteps()
    if (!found.length) {
      finish()
      return
    }
    setSteps(found)
    setIndex(0)
  }, [touring, finish])

  const current = steps[index]?.el
  const measure = useCallback(() => {
    if (current?.isConnected) setRect(current.getBoundingClientRect())
  }, [current])

  useEffect(() => {
    // Something can leave the page while the tour is on (a list refreshing): move on.
    if (current && !current.isConnected) step(1)
  }, [current, step])

  useLayoutEffect(() => {
    if (!current?.isConnected) return
    current.scrollIntoView?.({ block: "center", inline: "nearest" })
    measure()
  }, [current, measure])

  useEffect(() => {
    if (!touring) return
    window.addEventListener("resize", measure)
    document.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      document.removeEventListener("scroll", measure, true)
    }
  }, [touring, measure])

  useLayoutEffect(() => {
    if (!rect || !calloutRef.current) return
    const { offsetWidth, offsetHeight } = calloutRef.current
    setPlaced(
      placeCallout(rect, { width: offsetWidth, height: offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    )
  }, [rect, index])

  useEffect(() => {
    if (touring) nextRef.current?.focus()
  }, [touring, index, steps.length])

  useEffect(() => {
    if (!touring) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish()
      else if (event.key === "ArrowRight") step(1)
      else if (event.key === "ArrowLeft") step(-1)
    }
    // Only the tour's own controls and the help button work while it runs.
    const block = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(OWN_UI)) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("click", block, true)
    document.addEventListener("submit", block, true)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("click", block, true)
      document.removeEventListener("submit", block, true)
    }
  }, [touring, finish, step])

  if (!touring || !current || !rect) return null
  const last = index === steps.length - 1
  return (
    <div className="help-tour">
      <div
        className="help-spotlight"
        style={{
          left: rect.left - SPOTLIGHT_PAD,
          top: rect.top - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
        }}
      />
      <div
        ref={calloutRef}
        className={`help-callout ${placed?.below === false ? "is-above" : "is-below"}${placed?.arrow === null ? " no-arrow" : ""}`}
        role="dialog"
        aria-label="Guided tour"
        style={
          {
            left: placed?.left ?? 0,
            top: placed?.top ?? 0,
            visibility: placed ? "visible" : "hidden",
            "--arrow-x": `${placed?.arrow ?? 0}px`,
          } as CSSProperties
        }
      >
        <p className="help-tour-text">{steps[index].text}</p>
        <div className="help-tour-foot">
          <button type="button" className="help-tour-skip" onClick={finish}>
            Skip tour
          </button>
          <span className="help-tour-count">
            {index + 1} of {steps.length}
          </span>
          {index > 0 ? (
            <button type="button" className="help-tour-back" onClick={() => step(-1)}>
              Back
            </button>
          ) : null}
          <button ref={nextRef} type="button" className="help-tour-next" onClick={() => step(1)}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
