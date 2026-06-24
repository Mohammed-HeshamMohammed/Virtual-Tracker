"use client"

import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion"
import { cn } from "@/shared/utils/utils"

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

function useAuthTransition(duration = 0.26): Transition {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? { duration: 0 } : { duration, ease: EASE_OUT }
}

function useAuthStagger(delay = 0.05): number {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? 0 : delay
}

export function AuthMotionPane({
  isActive,
  className,
  children,
}: {
  isActive: boolean
  className?: string
  children: React.ReactNode
}) {
  const transition = useAuthTransition(0.28)

  return (
    <motion.div
      className={cn("col-start-1 row-start-1 flex flex-col", !isActive && "pointer-events-none", className)}
      initial={false}
      animate={
        isActive
          ? { opacity: 1, y: 0, zIndex: 10 }
          : { opacity: 0, y: 10, zIndex: 0 }
      }
      transition={transition}
      aria-hidden={!isActive}
    >
      {children}
    </motion.div>
  )
}

export function AuthPaneContent({
  paneKey,
  className,
  children,
}: {
  paneKey: string
  className?: string
  children: React.ReactNode
}) {
  const transition = useAuthTransition(0.26)
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={paneKey}
        className={cn("flex flex-col", className)}
        initial={reduceMotion ? false : { opacity: 0, x: 14 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, x: -12 }}
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export function AuthStaggerGroup({
  groupKey,
  className,
  children,
}: {
  groupKey?: string | boolean | number
  className?: string
  children: React.ReactNode
}) {
  const stagger = useAuthStagger(0.05)

  return (
    <motion.div
      key={groupKey !== undefined ? String(groupKey) : undefined}
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: stagger * 0.8 },
        },
      }}
    >
      {children}
    </motion.div>
  )
}

export function AuthStaggerItem({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const transition = useAuthTransition(0.22)
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      variants={
        reduceMotion
          ? undefined
          : {
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0, transition },
            }
      }
    >
      {children}
    </motion.div>
  )
}

export function AuthPresenceFade({
  show,
  children,
  className,
}: {
  show: boolean
  children: React.ReactNode
  className?: string
}) {
  const transition = useAuthTransition(0.2)
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="fade"
          className={cn("overflow-hidden", className)}
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
          transition={transition}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function AuthCrossfade({
  itemKey,
  className,
  children,
}: {
  itemKey: string
  className?: string
  children: React.ReactNode
}) {
  const transition = useAuthTransition(0.22)
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={itemKey}
        className={className}
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export function AuthAlertBanner({
  show,
  children,
  className,
}: {
  show: boolean
  children: React.ReactNode
  className?: string
}) {
  const transition = useAuthTransition(0.22)
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="alert"
          className={className}
          initial={reduceMotion ? false : { opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4, height: 0 }}
          transition={transition}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
