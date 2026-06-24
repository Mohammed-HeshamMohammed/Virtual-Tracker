"use client"

import { useRef, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { isFullBleedPage } from "@/app/page-layout"
import { getPageTransitionDirection } from "@/app/routes/nav-page-order"
import { cn } from "@/shared/utils/utils"

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]
const SLIDE_PX = 24

type PageTransitionShellProps = {
  activeItem: string
  transitionKey?: string
  children: ReactNode
}

export function PageTransitionShell({ activeItem, transitionKey, children }: PageTransitionShellProps) {
  const reduceMotion = useReducedMotion()
  const shellKey = transitionKey ?? activeItem
  const previousPageRef = useRef(activeItem)
  const previousShellKeyRef = useRef(shellKey)

  let direction = 0
  if (shellKey !== previousShellKeyRef.current) {
    direction = getPageTransitionDirection(previousPageRef.current, activeItem)
    previousShellKeyRef.current = shellKey
    previousPageRef.current = activeItem
  } else if (activeItem !== previousPageRef.current) {
    previousPageRef.current = activeItem
  }

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }
  const fullBleed = isFullBleedPage(activeItem)

  const variants = {
    initial: (dir: number) =>
      reduceMotion
        ? { opacity: 0 }
        : dir === 0
        ? { opacity: 0 }
        : { opacity: 0, x: dir > 0 ? SLIDE_PX : -SLIDE_PX },
    animate: { opacity: 1, x: 0 },
    exit: (dir: number) =>
      reduceMotion
        ? { opacity: 0 }
        : dir === 0
        ? { opacity: 0 }
        : { opacity: 0, x: dir > 0 ? -SLIDE_PX : SLIDE_PX }
  }

  return (
    <div
      className={cn(
        "relative w-full",
        fullBleed ? "h-full min-h-0 overflow-hidden" : "min-h-full",
      )}
    >
      <AnimatePresence initial={false} mode="wait" custom={direction}>
        <motion.div
          key={shellKey}
          custom={direction}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          className={cn(
            "flex w-full flex-col",
            fullBleed ? "absolute inset-0 min-h-0" : "relative min-h-full",
          )}
          transition={transition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
