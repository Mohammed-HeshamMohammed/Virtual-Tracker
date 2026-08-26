/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import * as ContextMenu from "@radix-ui/react-context-menu"
import {
  Star, ChevronLeft, ExternalLink, Eye, EyeOff, Plus,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { NAV_SECTIONS, type NavSection, type NavSubItem } from "@/shared/ui/layout/config/nav-sections"
import { SIDEBAR_THEME_DARK as dark, SIDEBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { prefetchChunkForPage } from "@/app"
import {
  allowedNavSectionIds,
  canAccessAllSidebarTabs,
  canAccessReviewCenter,
  clientHiddenPageIds,
  isReadOnlyRole,
} from "@/features/auth"
import { isClientRole } from "@/features/auth/permissions/team-member-assign-policy"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { SidebarUserCard } from "@/shared/ui/layout/components/sidebar/sidebar-user-card"

interface SidebarProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeItem: string
  onNavigate: (id: string) => void
}

function Divider({ sep }: { sep: string }) {
  return (
    <div className="flex justify-center py-1.5">
      <div className={cn("h-px w-[91%] rounded-full", sep)} />
    </div>
  )
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  activeItem,
  onNavigate,
}: SidebarProps) {
  const { isDark } = useTheme()
  const { memberRole } = useAuth()
  const t = isDark ? dark : light

  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  const canAccessAllTabs = canAccessAllSidebarTabs(memberRole)
  const canSeeReviewCenter = canAccessReviewCenter(memberRole)
  const isClient = isClientRole(memberRole)
  // Client and Viewer have nothing to add a task to - the button opened a
  // creation flow the server would refuse.
  const canAddTask = !isReadOnlyRole(memberRole)

  const isSectionActive = (s: NavSection) =>
    s.id === activeItem || s.pages?.some((p: NavSubItem) => p.id === activeItem) || false

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const visibleSections = useMemo(() => {
    let sections = NAV_SECTIONS.filter((s: NavSection) => s.id !== "favorites" && !hiddenSections.has(s.id))

    if (!canAccessAllTabs) {
      // A client reads their projects across the whole app; the server scopes
      // each of these to the projects linked to their client record. Settings
      // and Financials stay listed and stay disabled.
      const allowedSectionIds = allowedNavSectionIds(memberRole)
      sections = sections.filter((s: NavSection) => allowedSectionIds.has(s.id))

      // A client only ever sees the outcome of a timesheet, never the
      // approval queue - they are the project's client, not its approver.
      if ((canSeeReviewCenter || isClient) && !canAccessAllTabs) {
        sections = sections.map((s: NavSection) => {
          if (s.id !== "timesheets") return s
          return {
            ...s,
            pages: s.pages?.filter((p) => p.id === "timesheets-view"),
          }
        })
      }

      if (isClient) {
        const hidden = clientHiddenPageIds()
        sections = sections.map((s: NavSection) => ({
          ...s,
          pages: s.pages?.filter((p: NavSubItem) => !hidden.has(p.id)),
          subsections: s.subsections?.map((sub) => ({
            ...sub,
            items: sub.items.filter((item) => !hidden.has(item.id)),
          })),
        }))
      } else {
        sections = sections.map((s: NavSection) => {
          if (s.id === "dashboard") {
            return {
              ...s,
              pages: s.pages?.filter((p: NavSubItem) => p.id === "command-center")
            }
          }
          if (s.id === "project-management") {
            return {
              ...s,
              pages: s.pages?.filter((p: NavSubItem) => p.id === "pm-tasks")
            }
          }
          return s
        })
      }
    }

    return sections
  }, [hiddenSections, canAccessAllTabs, canSeeReviewCenter, isClient, memberRole])

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 80 : 272 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn("h-screen flex flex-col overflow-visible shrink-0 relative transition-colors duration-300", t.aside)}
    >
      <div className="flex items-center justify-between px-3 pt-5 pb-4 shrink-0">
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div key="logo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="whitespace-nowrap overflow-hidden min-w-0">
              <h1
                className={cn("text-[24px] tracking-tight leading-none", t.logoTitle)}
                style={{ fontFamily: "'Exo 2', system-ui, sans-serif", fontWeight: 500 }}
              >
                Virtual Tracker
              </h1>
              <p
                className={cn("text-[9px] uppercase tracking-widest font-medium leading-tight mt-0.5", t.logoSub)}
                style={{ paddingLeft: '1px' }}
              >
                Productivity Suite
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        <button onClick={onToggleCollapse} className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0", t.collapseBtn, isCollapsed && "mx-auto")} type="button">
          <motion.div animate={{ rotate: isCollapsed ? 180 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
            <ChevronLeft className={cn("w-4 h-4", t.textMuted)} />
          </motion.div>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto pt-2 pb-3 px-2" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.scrollThumb} transparent` }}>
        <style>{`
          aside nav::-webkit-scrollbar { width: 3px; }
          aside nav::-webkit-scrollbar-track { background: transparent; }
          aside nav::-webkit-scrollbar-thumb { background-color: ${t.scrollThumb}; border-radius: 9999px; }
          aside nav::-webkit-scrollbar-button { display: none; }
        `}</style>

        <div className="flex flex-col" style={{ gap: "6px" }}>
          {visibleSections.map((section: NavSection) => {
            const Icon = section.icon
            const isActive = isSectionActive(section)
            const isFav = favorites.has(section.id)

            return (
              <ContextMenu.Root key={section.id}>
                <ContextMenu.Trigger asChild>
                  {isCollapsed ? (
                    <IconTooltip text={section.label} placement="right" className="relative w-full">
                      <button
                        onClick={() => onNavigate(section.pages?.[0]?.id ?? section.id)}
                        onMouseEnter={() => prefetchChunkForPage(section.pages?.[0]?.id ?? section.id)}
                        className={cn(
                          "relative w-full flex items-center rounded-xl text-sm font-medium tracking-tight transition-colors duration-150 group",
                          "justify-center p-2.5",
                          isActive ? t.itemActive : cn(t.itemInactive, t.itemHover)
                        )}
                        type="button"
                      >
                        {isActive && <span className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full", t.bar)} />}
                        <Icon className={cn("shrink-0 w-[18px] h-[18px] transition-colors", isActive ? t.iconActive : isFav ? "text-amber-400" : cn(t.iconDefault, "group-hover:text-inherit"))} />
                      </button>
                    </IconTooltip>
                  ) : (
                    <button
                      onClick={() => onNavigate(section.pages?.[0]?.id ?? section.id)}
                      onMouseEnter={() => prefetchChunkForPage(section.pages?.[0]?.id ?? section.id)}
                      className={cn(
                        "relative w-full flex items-center rounded-xl text-sm font-medium tracking-tight transition-colors duration-150 group",
                        "px-3 py-2.5 gap-2.5",
                        isActive ? t.itemActive : cn(t.itemInactive, t.itemHover)
                      )}
                      type="button"
                    >
                      {isActive && <span className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full", t.bar)} />}
                      <Icon className={cn("shrink-0 w-[18px] h-[18px] transition-colors", isActive ? t.iconActive : isFav ? "text-amber-400" : cn(t.iconDefault, "group-hover:text-inherit"))} />
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="flex-1 text-left truncate">
                        {section.label}
                      </motion.span>
                      {isFav && section.id !== "favorites" && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                    </button>
                  )}
                </ContextMenu.Trigger>

                <ContextMenu.Portal>
                  <ContextMenu.Content className={cn("min-w-[190px] rounded-xl shadow-xl border p-1.5 z-60 animate-in fade-in-0 zoom-in-95", t.contextMenu)}>
                    <ContextMenu.Item onClick={() => toggleSet(setFavorites, section.id)}
                      className={cn("flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors", t.contextItem)}>
                      <Star className={cn("w-4 h-4", isFav ? "text-amber-400 fill-amber-400" : t.iconDefault)} />
                      {isFav ? "Remove from Favorites" : "Add to Favorites"}
                    </ContextMenu.Item>
                    <ContextMenu.Item onClick={() => window.open(`/${section.id.replace("-", "/")}`, "_blank")}
                      className={cn("flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors", t.contextItem)}>
                      <ExternalLink className={cn("w-4 h-4", t.iconDefault)} />
                      Open in New Tab
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={cn("h-px my-1 mx-3", t.sep)} />
                    <ContextMenu.Item onClick={() => toggleSet(setHiddenSections, section.id)}
                      className={cn("flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors", t.contextItem)}>
                      <EyeOff className={cn("w-4 h-4", t.iconDefault)} />
                      Hide from Sidebar
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            )
          })}
        </div>

        {hiddenSections.size > 0 && !isCollapsed && (
          <div className={cn("mt-4 pt-3 border-t", t.hiddenBorder)}>
            <p className={cn("text-[9px] font-bold uppercase tracking-widest px-2 mb-2", t.textMuted)}>Hidden</p>
            {Array.from(hiddenSections).map(id => {
              const section = NAV_SECTIONS.find((s: NavSection) => s.id === id)
              if (!section) return null
              const Icon = section.icon
              return (
                <button key={id} onClick={() => toggleSet(setHiddenSections, id)}
                  className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors", t.textMuted, t.itemHover)} type="button">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{section.label}</span>
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </nav>

      <div className="px-2 pb-4 pt-1 shrink-0">
        <Divider sep={t.sep} />

        <div className="mt-3 space-y-3">
          {canAddTask ? (
          <button
            className={cn("relative w-full flex items-center justify-center py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.02] active:scale-95 overflow-hidden group", t.addTaskText)}
            style={{ background: `linear-gradient(135deg, ${t.addTaskFrom}, ${t.addTaskTo})` }} type="button"
          >
            <span className="absolute inset-0 bg-white opacity-0 group-hover:opacity-[0.12] transition-opacity duration-200 rounded-xl pointer-events-none" />
            <Plus className="w-4 h-4 shrink-0 relative z-10" />
            {!isCollapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="ml-2 whitespace-nowrap relative z-10">
                Add Task
              </motion.span>
            )}
          </button>
          ) : null}

          <SidebarUserCard
            isCollapsed={isCollapsed}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </motion.aside>
  )
}
