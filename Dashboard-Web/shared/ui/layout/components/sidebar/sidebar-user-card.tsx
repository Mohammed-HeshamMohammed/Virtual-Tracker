/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MoreVertical } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { UserAvatarImage } from "@/shared/ui/user-avatar-image"
import { resolveProfileAvatarUrl } from "@/features/auth/services/profile-image"
import { THEME_OPTIONS, USER_MENU, SIDEBAR_THEME_DARK as dark, SIDEBAR_THEME_LIGHT as light, type UserMenuAction } from "@/shared/ui/shared/constants"

interface SidebarUserCardProps {
  isCollapsed: boolean
  onNavigate: (id: string) => void
}

export function SidebarUserCard({ isCollapsed, onNavigate }: SidebarUserCardProps) {
  const { theme, setTheme, isDark } = useTheme()
  const { user, profile, logout } = useAuth()
  const t = isDark ? dark : light

  const userDisplayName = user?.displayName || "User"
  const userEmail = user?.email || ""
  const userAvatar = resolveProfileAvatarUrl(
    profile,
    user,
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${userDisplayName}`,
  )

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [userMenuOpen])

  const handleUserMenuAction = (action: UserMenuAction) => {
    switch (action) {
      case "profile":
        onNavigate("profile")
        break
      case "settings":
        onNavigate("settings-all")
        break
      case "switch":
        break
      case "logout":
        logout()
        break
    }
    setUserMenuOpen(false)
  }

  return (
    <div className="mt-3 space-y-3">
      <div ref={userMenuRef} className="relative">
        <div className={cn("flex items-center rounded-xl", t.userCard, isCollapsed ? "justify-center p-2" : "px-2 py-2")}>
          <UserAvatarImage src={userAvatar} alt={userDisplayName} className="w-8 h-8 rounded-full border-2 border-white/20 shrink-0 bg-slate-200" />
          {!isCollapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0 ml-2.5">
              <p className={cn("text-xs font-bold truncate leading-none", t.text)}>{userDisplayName}</p>
              <p className={cn("text-[10px] truncate mt-0.5", t.textMuted)}>{userEmail}</p>
            </motion.div>
          )}
          {!isCollapsed && (
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className={cn("shrink-0 p-1 rounded-md transition-colors cursor-pointer ml-auto", t.textMuted, userMenuOpen ? "opacity-100" : "opacity-60 hover:opacity-100")} type="button"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          )}
        </div>

        <AnimatePresence>
          {userMenuOpen && !isCollapsed && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className={cn("absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden z-60", t.userMenu)}
            >
              <div className={cn("flex items-center gap-2.5 px-3 py-3", t.userMenuHead)}>
                <UserAvatarImage src={userAvatar} alt={userDisplayName} className="w-8 h-8 rounded-full border-2 border-white/20 shrink-0 bg-slate-200" />
                <div className="min-w-0">
                  <p className={cn("text-xs font-bold truncate leading-none", t.text)}>{userDisplayName}</p>
                  <p className={cn("text-[10px] truncate mt-0.5", t.textMuted)}>{userEmail}</p>
                </div>
              </div>

              <div className="p-1.5 space-y-0.5">
                {USER_MENU.map(m => {
                  const MIcon = m.icon
                  return (
                    <button key={m.label} onClick={() => handleUserMenuAction(m.action)}
                      className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                        m.danger ? "text-red-400 hover:bg-red-500/10" : t.contextItem)} type="button">
                      <MIcon className={cn("w-4 h-4 shrink-0", m.danger ? "text-red-400" : t.iconDefault)} />
                      {m.label}
                    </button>
                  )
                })}
              </div>

              <div className={cn("px-3 py-2.5", t.userMenuFoot)}>
                <p className={cn("text-[10px] font-bold uppercase tracking-widest mb-2", t.textMuted)}>Theme</p>
                <div className="flex items-center gap-1.5">
                  {THEME_OPTIONS.map(opt => {
                    const TIcon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        onMouseDown={e => {
                          e.stopPropagation()
                          setTheme(opt.value)
                        }}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-all",
                          theme === opt.value ? t.themeActive : t.themeInactive
                        )} type="button"
                      >
                        <TIcon className="w-3.5 h-3.5" />
                        <span className="text-[11px]">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
