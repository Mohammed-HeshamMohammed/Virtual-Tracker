"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronRight, ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import {
  getSectionForPage, getPageLabel, getSubsectionForPage,
  PAGE_PARENTS, sortedItems, type NavSection, type NavSubItem, type NavSubSection
} from "@/shared/ui/layout/config/nav-sections"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { visibleNavSections } from "@/features/auth"
import { isComingSoonPage } from "@/shared/constants/coming-soon-pages"
import { prefetchChunkForPage } from "@/app"

interface BreadcrumbsProps {
  activeItem: string
  onNavigate: (id: string) => void
}

const dropdownMotion = {
  initial: { opacity: 0, y: -8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.96 },
  transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] as const },
}

export function Breadcrumbs({ activeItem, onNavigate }: BreadcrumbsProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { memberRole } = useAuth()

  const [sectionOpen, setSectionOpen] = useState(false)
  const [showSubsectionDropdown, setShowSubsectionDropdown] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  const sectionById = useMemo(() => {
    const map = new Map<string, NavSection>()
    for (const section of visibleNavSections(memberRole)) map.set(section.id, section)
    return map
  }, [memberRole])

  const currentSectionRaw = getSectionForPage(activeItem)
  const currentSection = currentSectionRaw ? sectionById.get(currentSectionRaw.id) : undefined
  const currentPage = getPageLabel(activeItem)
  const subsectionInfoRaw = getSubsectionForPage(activeItem)
  const subsectionInfo = subsectionInfoRaw && sectionById.has(subsectionInfoRaw.section.id) ? subsectionInfoRaw : undefined
  const parentPageId = PAGE_PARENTS[activeItem] ?? null
  const parentPageLabel = parentPageId ? getPageLabel(parentPageId) : null

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (sectionRef.current && !sectionRef.current.contains(e.target as Node)) {
        setSectionOpen(false)
        setShowSubsectionDropdown(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  function navigateTo(id: string) {
    onNavigate(id)
    setSectionOpen(false)
    setShowSubsectionDropdown(false)
  }

  return (
    <div className="flex items-center">
      <div ref={sectionRef} className="relative flex items-center gap-1.5">
        {activeItem === "profile" ? (
          <span className={cn("text-sm font-bold whitespace-nowrap rounded-lg px-2 py-1", t.pageBtn)}>Edit account</span>
        ) : activeItem === "settings-all" ? (
          <span className={cn("text-sm font-bold whitespace-nowrap rounded-lg px-2 py-1", t.pageBtn)}>Settings</span>
        ) : activeItem === "reports-all" ? (
          <span className={cn("text-sm font-bold whitespace-nowrap rounded-lg px-2 py-1", t.pageBtn)}>Reports</span>
        ) : (
          <>
            <button
              onClick={() => { const p = currentSection?.pages?.[0]?.id ?? currentSection?.id; if (p) onNavigate(p) }}
              className={cn("text-sm font-medium transition-colors whitespace-nowrap rounded-lg px-2 py-1", t.breadcrumbBtn)} type="button"
            >
              {currentSection?.label ?? "Home"}
            </button>

            <ChevronRight className={cn("w-3.5 h-3.5 shrink-0", t.breadcrumbSep)} />

            {subsectionInfo ? (
              <>
                <button
                  onClick={() => { setShowSubsectionDropdown(v => !v); setSectionOpen(false) }}
                  className={cn("flex items-center gap-1 text-sm font-medium transition-colors whitespace-nowrap rounded-lg px-2 py-1", t.breadcrumbBtn)} type="button"
                >
                  {subsectionInfo.subsection.label}
                  <motion.div animate={{ rotate: showSubsectionDropdown ? 180 : 0 }} transition={{ duration: 0.18 }}>
                    <ChevronDown className={cn("w-3.5 h-3.5", t.chevron)} />
                  </motion.div>
                </button>

                <ChevronRight className={cn("w-3.5 h-3.5 shrink-0", t.breadcrumbSep)} />

                <div className="relative">
                  <button
                    onClick={() => { setSectionOpen(v => !v); setShowSubsectionDropdown(false) }}
                    className={cn("flex items-center gap-1 text-sm font-bold transition-all rounded-lg px-2 py-1",
                      sectionOpen ? t.pageBtnOpen : t.pageBtn)} type="button"
                  >
                    {currentPage}
                    <motion.div animate={{ rotate: sectionOpen ? 180 : 0 }} transition={{ duration: 0.18 }}>
                      <ChevronDown className={cn("w-3.5 h-3.5", t.chevron)} />
                    </motion.div>
                  </button>

                  <AnimatePresence>
                    {sectionOpen && (
                      <motion.div {...dropdownMotion}
                        className={cn("absolute left-0 top-full mt-2 w-56 rounded-xl py-1.5 z-50 overflow-hidden", t.dropdown)}
                      >
                        <div className={cn("px-3 py-2 mb-1", t.dropHead)}>
                          <p className={cn("text-[10px] font-bold uppercase tracking-widest", t.dropHeadLabel)}>
                            {subsectionInfo.subsection.label}
                          </p>
                        </div>
                        {subsectionInfo.subsection.items.map((item: NavSubItem) => (
                          <DropdownItem key={item.id} id={item.id} label={item.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <AnimatePresence>
                  {showSubsectionDropdown && currentSection && (
                    <motion.div {...dropdownMotion}
                      className={cn("absolute left-0 top-full mt-2 w-56 rounded-xl py-1.5 z-50 overflow-hidden", t.dropdown)}
                    >
                      <div className={cn("px-3 py-2 mb-1", t.dropHead)}>
                        <p className={cn("text-[10px] font-bold uppercase tracking-widest", t.dropHeadLabel)}>Reports</p>
                      </div>
                      {sortedItems(currentSection.pages, true).filter((p: NavSubItem) => !p.sortLast).map((page: NavSubItem) => (
                        <DropdownItem key={page.id} id={page.id} label={page.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                      ))}
                      {currentSection.subsections
                        ?.filter((s: NavSubSection) => !s.hideFromDropdown)
                        .map((sub: NavSubSection) => (
                          <button key={sub.label} onClick={() => navigateTo(sub.items[0]?.id)}
                            className={cn("w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors text-left", t.dropItem)} type="button">
                            {sub.label}
                          </button>
                        ))}
                      {sortedItems(currentSection.pages, true).filter((p: NavSubItem) => p.sortLast).map((page: NavSubItem) => (
                        <DropdownItem key={page.id} id={page.id} label={page.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : parentPageId && parentPageLabel ? (
              <>
                <button
                  onClick={() => onNavigate(parentPageId)}
                  className={cn("text-sm font-medium transition-colors whitespace-nowrap rounded-lg px-2 py-1", t.breadcrumbBtn)} type="button"
                >
                  {parentPageLabel}
                </button>

                <ChevronRight className={cn("w-3.5 h-3.5 shrink-0", t.breadcrumbSep)} />

                <AnimatePresence mode="wait">
                  <motion.span
                    key={activeItem}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.18 }}
                    className={cn("text-sm font-bold whitespace-nowrap rounded-lg px-2 py-1", t.pageBtn)}
                  >
                    {currentPage}
                  </motion.span>
                </AnimatePresence>
              </>
            ) : (
              (() => {
                const availablePages = sortedItems(
                  currentSection?.pages?.filter((p: NavSubItem) => !PAGE_PARENTS[p.id]),
                  true
                )
                const hasMultiplePages = availablePages.length > 1 || currentSection?.subsections

                return hasMultiplePages ? (
                  <div className="relative">
                    <button
                      onClick={() => setSectionOpen(v => !v)}
                      className={cn("flex items-center gap-1 text-sm font-bold transition-all rounded-lg px-2 py-1",
                        sectionOpen ? t.pageBtnOpen : t.pageBtn)} type="button"
                    >
                      {currentPage}
                      <motion.div animate={{ rotate: sectionOpen ? 180 : 0 }} transition={{ duration: 0.18 }}>
                        <ChevronDown className={cn("w-3.5 h-3.5", t.chevron)} />
                      </motion.div>
                    </button>

                    <AnimatePresence>
                      {sectionOpen && currentSection && (
                        <motion.div {...dropdownMotion}
                          className={cn("absolute left-0 top-full mt-2 w-56 rounded-xl py-1.5 z-50 overflow-hidden", t.dropdown)}
                        >
                          <div className={cn("px-3 py-2 mb-1", t.dropHead)}>
                            <p className={cn("text-[10px] font-bold uppercase tracking-widest", t.dropHeadLabel)}>{currentSection.label}</p>
                          </div>

                          {currentSection.subsections ? (
                            <>
                              {sortedItems(currentSection.pages, true).filter((p: NavSubItem) => !p.sortLast).map((page: NavSubItem) => (
                                <DropdownItem key={page.id} id={page.id} label={page.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                              ))}
                              {currentSection.subsections.filter((s: NavSubSection) => !s.hideFromDropdown).map((sub: NavSubSection) => (
                                <button key={sub.label} onClick={() => navigateTo(sub.items[0]?.id)}
                                  className={cn("w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors text-left", t.dropItem)} type="button">
                                  {sub.label}
                                </button>
                              ))}
                              {sortedItems(currentSection.pages, true).filter((p: NavSubItem) => p.sortLast).map((page: NavSubItem) => (
                                <DropdownItem key={page.id} id={page.id} label={page.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                              ))}
                            </>
                          ) : (
                            availablePages.map((page: NavSubItem) => (
                              <DropdownItem key={page.id} id={page.id} label={page.label} activeItem={activeItem} onClick={navigateTo} t={t} />
                            ))
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <span className={cn("text-sm font-bold whitespace-nowrap rounded-lg px-2 py-1", t.pageBtn)}>
                    {currentPage}
                  </span>
                )
              })()
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DropdownItem({
  id,
  label,
  activeItem,
  onClick,
  t,
}: {
  id: string
  label: string
  activeItem: string
  onClick: (id: string) => void
  t: typeof dark
}) {
  const isCur = activeItem === id
  const comingSoon = isComingSoonPage(id)

  return (
    <button
      onClick={() => onClick(id)}
      onMouseEnter={() => !comingSoon && prefetchChunkForPage(id)}
      className={cn(
        "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors",
        isCur ? t.dropItemActive : t.dropItem,
        comingSoon && "opacity-70",
      )}
      type="button"
    >
      <span>{label}</span>
      {comingSoon ? (
        <span className={cn("text-[10px] font-semibold uppercase tracking-wide", t.dropHeadLabel)}>Soon</span>
      ) : isCur ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : null}
    </button>
  )
}
