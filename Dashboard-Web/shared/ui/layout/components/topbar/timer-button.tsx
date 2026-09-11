"use client"

import { motion } from "framer-motion"
import { Play } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import type { NavigateHandler } from "@/app/routes/types"

interface TimerButtonProps {
  isCollapsed?: boolean
  onNavigate: NavigateHandler
}

/**
 * The top bar's Start button. It opens the Tools page, where the member gets
 * the Virtual Tracker Agent - and that is all it does.
 *
 * It used to do far more. When no web timer was running it polled the
 * member's session every 8s and, finding one the agent had started, switched
 * on the dashboard's whole timer runtime ("adopt"). It was the only thing that
 * ever did. That runtime then watched the agent and paused its timer whenever
 * a status check came back "offline" - a heartbeat gap, a slow request, a
 * Redis restart - and showed "Start the Virtual Tracker Agent on this PC...
 * Timer paused until the agent reconnects" while the agent was plainly
 * running. The button also showed a live clock and hosted the timer toasts.
 *
 * The agent owns the timer. The dashboard starts, pauses and stops nothing, so
 * there is nothing here left to get wrong. See PLAN-timer-stop-resilience.md;
 * test/timer-stop-contract.test.mjs fails if any of it comes back.
 */
export function TimerButton({ isCollapsed = false, onNavigate }: TimerButtonProps) {
  const { isDark } = useTheme()

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onNavigate("activity-tools")}
      title="Get the Virtual Tracker Agent"
      aria-label="Start: open Tools to get the Virtual Tracker Agent"
      className={cn(
        "relative flex items-center font-bold text-sm text-white rounded-xl overflow-hidden transition-shadow",
        isCollapsed ? "p-2.5" : "gap-2 px-4 py-2",
        isDark ? "shadow-lg shadow-[#4be277]/20" : "shadow-lg shadow-green-600/20",
      )}
      style={{
        background: isDark
          ? "linear-gradient(135deg,#4be277,#22c55e)"
          : "linear-gradient(135deg,#006e2f,#22c55e)",
      }}
    >
      <Play className={cn("shrink-0 fill-white", isCollapsed ? "w-5 h-5 ml-0.5" : "w-4 h-4 ml-0.5")} />
      {!isCollapsed && (
        <span className={cn("whitespace-nowrap", isDark ? "text-[#0c1324]" : "text-white")}>Start Now</span>
      )}
    </motion.button>
  )
}
