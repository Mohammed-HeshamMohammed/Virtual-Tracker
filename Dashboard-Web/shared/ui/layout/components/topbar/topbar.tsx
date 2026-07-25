/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { HelpCircle } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { canAccessAllSidebarTabs } from "@/features/auth"
import { isClientRole } from "@/features/auth/permissions/team-member-assign-policy"
import { GlobalSearchBar } from "@/shared/ui/layout/components/topbar/global-search-bar"
import { NotificationsBell } from "@/shared/ui/layout/components/topbar/notifications-bell"
import { Breadcrumbs } from "@/shared/ui/layout/components/topbar/breadcrumbs"
import { TimerButton } from "@/shared/ui/layout/components/topbar/timer-button"

interface TopbarProps {
  activeItem: string
  onNavigate: (id: string) => void
  isCollapsed?: boolean
  selectedTaskForTimer: any
}

export function Topbar({ activeItem, onNavigate, isCollapsed = false, selectedTaskForTimer }: TopbarProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { memberRole } = useAuth()

  const canAccessAllTabs = canAccessAllSidebarTabs(memberRole)
  const isClient = isClientRole(memberRole)

  return (
    <header className={cn(
      "sticky top-0 z-40 grid grid-cols-3 items-center w-full px-6 backdrop-blur-xl shrink-0 h-16 transition-colors duration-300",
      t.header
    )}>
      {/* Left: Breadcrumb */}
      <Breadcrumbs activeItem={activeItem} onNavigate={onNavigate} />

      {/* Center: Global app search */}
      <motion.div layout="position" className="flex items-center justify-center">
        <GlobalSearchBar
          onNavigate={onNavigate}
          canAccessAllTabs={canAccessAllTabs}
          activePageId={activeItem}
        />
      </motion.div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 justify-end">
        <NotificationsBell onNavigate={onNavigate} />

        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          className={cn("w-10 h-10 flex items-center justify-center rounded-xl transition-colors", t.iconBtn)}
        >
          <HelpCircle className="w-5 h-5" />
        </motion.button>

        <div className={cn("h-8 w-px mx-1", t.divider)} />

        {!isClient && (
          <TimerButton isCollapsed={isCollapsed} selectedTaskForTimer={selectedTaskForTimer} onNavigate={onNavigate} />
        )}
      </div>
    </header>
  )
}
