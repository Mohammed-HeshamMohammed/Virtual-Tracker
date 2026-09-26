"use client"

import { HelpCircle } from "lucide-react"
import { setHelpMode, useHelpMode } from "@/shared/ui/help"
import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { isClientRole } from "@/features/auth/permissions/team-member-assign-policy"
import { GlobalSearchBar } from "@/shared/ui/layout/components/topbar/global-search-bar"
import { NotificationsBell } from "@/shared/ui/layout/components/topbar/notifications-bell"
import { Breadcrumbs } from "@/shared/ui/layout/components/topbar/breadcrumbs"
import { TimerButton } from "@/shared/ui/layout/components/topbar/timer-button"

interface TopbarProps {
  activeItem: string
  onNavigate: (id: string) => void
  isCollapsed?: boolean
}

export function Topbar({ activeItem, onNavigate, isCollapsed = false }: TopbarProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { memberRole } = useAuth()

  const isClient = isClientRole(memberRole)
  const helping = useHelpMode()

  return (
    <header className={cn(
      "sticky top-0 z-40 grid grid-cols-3 items-center w-full px-6 backdrop-blur-xl shrink-0 h-16 transition-colors duration-300",
      t.header
    )}>
      <div data-help="Where you are. Use it to move between the pages of this section." className="min-w-0 justify-self-start">
        <Breadcrumbs activeItem={activeItem} onNavigate={onNavigate} />
      </div>

      <motion.div layout="position" data-help="Search: type a page or setting name to jump straight to it." className="flex items-center justify-center px-4 min-w-0">
        <GlobalSearchBar
          onNavigate={onNavigate}
          memberRole={memberRole}
          activePageId={activeItem}
        />
      </motion.div>

      <div className="flex items-center gap-1 justify-end">
        <span data-help="Notifications: messages and requests for you. Open one to go to it." className="inline-flex">
          <NotificationsBell onNavigate={onNavigate} />
        </span>

        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          type="button"
          aria-label="Help"
          aria-pressed={helping}
          data-help-toggle
          data-help={helping ? "Leave help mode." : "Help: hover anything to see what it is for."}
          onClick={() => setHelpMode(!helping)}
          className={cn("w-10 h-10 flex items-center justify-center rounded-xl transition-colors", t.iconBtn, helping && "bg-blue-600/15 text-blue-600")}
        >
          <HelpCircle className="w-5 h-5" />
        </motion.button>

        <div className={cn("h-8 w-px mx-1", t.divider)} />

        {!isClient && (
          <span data-help="Start Now: opens Tools, where you get My Virtual Tracker to track your time." className="inline-flex">
            <TimerButton isCollapsed={isCollapsed} onNavigate={onNavigate} />
          </span>
        )}
      </div>
    </header>
  )
}
