"use client"

import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { DashboardReconnectCard } from "@/shared/ui/errors/dashboard-reconnect-card"
import {
  BACKEND_RECONNECTING_HINT,
  BACKEND_UNAVAILABLE_MESSAGE,
} from "@/infrastructure/api/backend-connection-events"

type DashboardReconnectOverlayProps = {
  open: boolean
  isDark: boolean
  error?: string | null
  isReconnecting?: boolean
  onRetry?: () => void
  reconnectHint?: string
}

const backdropTransition = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const }
const cardTransition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }

export function DashboardReconnectOverlay({
  open,
  isDark,
  error,
  isReconnecting = false,
  onRetry,
  reconnectHint = BACKEND_RECONNECTING_HINT,
}: DashboardReconnectOverlayProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="dashboard-reconnect-overlay"
          className="fixed inset-0 z-200 flex items-center justify-center overflow-hidden p-4 sm:p-6"
          aria-live="polite"
          role="dialog"
          aria-modal="true"
          aria-label={isReconnecting ? "Reconnecting" : "Service unavailable"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            aria-hidden
            className={cn(
              "absolute inset-0 backdrop-blur-md",
              isDark ? "bg-[#0a0e18]/55" : "bg-slate-900/20",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
          />

          <motion.div
            className="relative z-10 w-full max-w-md px-1"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={cardTransition}
          >
            <DashboardReconnectCard
              isDark={isDark}
              error={error ?? BACKEND_UNAVAILABLE_MESSAGE}
              isReconnecting={isReconnecting}
              onRetry={onRetry}
              reconnectHint={reconnectHint}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
