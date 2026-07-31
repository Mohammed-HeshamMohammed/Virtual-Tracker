"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { MODAL_SPRING, MODAL_TRANSITION_MS } from "@/shared/ui/motion/modal-motion"

type ExpandCollapseProps = {
  show: boolean
  children: ReactNode
  className?: string
}

/** Height expansion without unmounting its contents - grid-rows animate
 * (0fr -> 1fr) rather than max-height, so it never clips a taller reveal and
 * never needs a magic-number max-height guess. Ported from the Client
 * modal's animated-primitives.tsx, generalized for app-wide reuse. */
export function ExpandCollapse({ show, children, className }: ExpandCollapseProps) {
  return (
    <div
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]",
        show ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        className,
      )}
      style={{ transitionDuration: MODAL_TRANSITION_MS }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

type SegmentedOption<T extends string> = { id: T; label: string; icon?: ReactNode }

type SegmentedControlProps<T extends string> = {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  trackClassName?: string
  pillClassName?: string
  buttonClassName?: (active: boolean) => string
}

/** Sliding pill indicator - one element moves, never unmounts. Ported from
 * the Client modal's animated-primitives.tsx, generalized for app-wide reuse
 * (adds an optional per-option icon, unused by the client modal's version). */
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
      className={cn("relative inline-flex w-full gap-1 rounded-xl p-1", trackClassName)}
      role="tablist"
    >
      <motion.span
        aria-hidden
        className={cn("pointer-events-none absolute top-1 bottom-1 rounded-lg shadow-sm", pillClassName)}
        animate={{ left: pill.left, width: pill.width }}
        initial={false}
        transition={reduceMotion ? { duration: 0 } : MODAL_SPRING}
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
              "relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200",
              buttonClassName?.(active),
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
