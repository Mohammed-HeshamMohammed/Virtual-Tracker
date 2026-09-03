"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { AuthPresenceFade } from "@/features/auth/components/auth-motion"
import type { AuthStyles } from "@/features/auth/components/style-utils"

export function AuthSidePanel({
  side,
  visible,
  children,
  className,
}: {
  side: "left" | "right"
  visible: boolean
  children: React.ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.aside
          key={`${side}-panel`}
          aria-live="polite"
          className={cn(
            "pointer-events-auto absolute top-8 z-10 hidden w-[220px] lg:block xl:w-[240px]",
            side === "left" ? "right-full mr-4 xl:mr-6" : "left-full ml-4 xl:ml-6",
            className,
          )}
          initial={reduceMotion ? false : { opacity: 0, x: side === "left" ? 10 : -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: side === "left" ? 10 : -10 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

export function AuthHelperPanel({
  title,
  children,
  isDark,
  styles,
}: {
  title: string
  children: React.ReactNode
  isDark: boolean
  styles: AuthStyles
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-lg",
        styles.card,
        isDark ? "border-[#3d4a3d]/30" : "border-slate-200/80",
      )}
    >
      <h3 className={cn("mb-2 text-sm font-bold", styles.heading)}>{title}</h3>
      <div className={cn("space-y-2 text-xs leading-relaxed", styles.bodySub)}>{children}</div>
    </div>
  )
}

export function AuthMobileHelperStrip({
  visible,
  children,
}: {
  visible: boolean
  children: React.ReactNode
}) {
  return (
    <AuthPresenceFade show={visible}>
      <div className="mt-3 lg:hidden">{children}</div>
    </AuthPresenceFade>
  )
}
