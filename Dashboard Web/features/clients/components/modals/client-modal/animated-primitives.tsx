"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import {
  CLIENT_MODAL_CROSSFADE,
  CLIENT_MODAL_EASE_CSS,
  CLIENT_MODAL_FADE,
  CLIENT_MODAL_LAYOUT,
  CLIENT_MODAL_SLIDE_PX,
  CLIENT_MODAL_TRANSITION_MS,
} from "@/features/clients/components/modals/client-modal/client-modal-motion"

type CrossfadePanelProps = {
  panelKey: string
  children: ReactNode
  className?: string
  variant?: "slide" | "fade"
}

/** Opacity crossfade with layout-driven height. */
export function CrossfadePanel({ panelKey, children, className, variant = "slide" }: CrossfadePanelProps) {
  const reduceMotion = useReducedMotion()
  const slide = variant === "slide"

  return (
    <motion.div
      layout
      className={cn("overflow-hidden", className)}
      transition={{ layout: CLIENT_MODAL_LAYOUT }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={panelKey}
          layout
          initial={reduceMotion ? false : { opacity: 0, ...(slide ? { y: CLIENT_MODAL_SLIDE_PX } : {}) }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, ...(slide ? { y: -CLIENT_MODAL_SLIDE_PX } : {}) }}
          transition={{
            opacity: CLIENT_MODAL_CROSSFADE,
            y: slide ? CLIENT_MODAL_CROSSFADE : { duration: 0 },
            layout: CLIENT_MODAL_LAYOUT,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

type ExpandCollapseProps = {
  show: boolean
  children: ReactNode
  className?: string
}

/** Height expansion without unmounting the parent layout. */
export function ExpandCollapse({ show, children, className }: ExpandCollapseProps) {
  return (
    <div
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]",
        show ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        className,
      )}
      style={{ transitionDuration: CLIENT_MODAL_TRANSITION_MS }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

type DualPanelSwapProps = {
  showSecondary: boolean
  primary: ReactNode
  secondary: ReactNode
  className?: string
}

/** Morph height between two panels without unmounting either side. */
export function DualPanelSwap({ showSecondary, primary, secondary, className }: DualPanelSwapProps) {
  return (
    <div
      className={cn("grid overflow-hidden ease-[cubic-bezier(0.22,1,0.36,1)]", className)}
      style={{
        gridTemplateRows: showSecondary ? "0fr 1fr" : "1fr 0fr",
        transitionProperty: "grid-template-rows",
        transitionDuration: CLIENT_MODAL_TRANSITION_MS,
        transitionTimingFunction: CLIENT_MODAL_EASE_CSS,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "ease-[cubic-bezier(0.22,1,0.36,1)] transition-opacity",
            showSecondary ? "pointer-events-none opacity-0" : "opacity-100",
          )}
          style={{ transitionDuration: CLIENT_MODAL_TRANSITION_MS }}
        >
          {primary}
        </div>
      </div>
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "ease-[cubic-bezier(0.22,1,0.36,1)] transition-opacity",
            showSecondary ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          style={{ transitionDuration: CLIENT_MODAL_TRANSITION_MS }}
        >
          {secondary}
        </div>
      </div>
    </div>
  )
}

type SegmentedOption<T extends string> = { id: T; label: string }

type SegmentedControlProps<T extends string> = {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  trackClassName?: string
  pillClassName?: string
  buttonClassName?: (active: boolean) => string
}

/** Sliding pill indicator — one element moves, never unmounts. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  trackClassName,
  pillClassName,
  buttonClassName,
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})
  const [pill, setPill] = useState({ left: 0, width: 0 })
  const reduceMotion = useReducedMotion()

  useLayoutEffect(() => {
    const update = () => {
      const track = trackRef.current
      const button = buttonRefs.current[value]
      if (!track || !button) return

      const trackRect = track.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      setPill({
        left: buttonRect.left - trackRect.left,
        width: buttonRect.width,
      })
    }

    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [value, options])

  return (
    <div
      ref={trackRef}
      className={cn("relative inline-flex w-fit max-w-full gap-1 rounded-xl p-1", trackClassName)}
      role="tablist"
    >
      <motion.span
        aria-hidden
        className={cn("pointer-events-none absolute top-1 bottom-1 rounded-lg shadow-sm", pillClassName)}
        animate={{ left: pill.left, width: pill.width }}
        initial={false}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 }
        }
      />
      {options.map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            ref={(node) => {
              buttonRefs.current[option.id] = node
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors duration-200",
              buttonClassName?.(active),
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
