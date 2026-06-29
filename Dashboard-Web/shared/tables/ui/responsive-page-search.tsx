/* eslint-disable react-doctor/no-multi-comp */
"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export type PageSearchTheme = {
  searchWrap: string
  searchIcon: string
  searchInput: string
}

export function useResponsivePageSearch(compactBelowWidth = 880) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return

    const update = (width: number) => {
      const nextCompact = width < compactBelowWidth
      setCompact(nextCompact)
      if (!nextCompact) setExpanded(false)
    }

    update(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [compactBelowWidth])

  return { toolbarRef, compact, expanded, setExpanded }
}

export function PageSearchInput({
  value,
  onChange,
  placeholder,
  theme,
  className,
  inputRef,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  theme: PageSearchTheme
  className?: string
  inputRef?: RefObject<HTMLInputElement | null>
  autoFocus?: boolean
}) {
  return (
    <div className={cn("relative min-w-0 rounded-lg border", theme.searchWrap, className)}>
      <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", theme.searchIcon)} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn("w-full min-w-0 bg-transparent py-2 pl-10 pr-4 text-sm focus:outline-none", theme.searchInput)} aria-label="Interactive control"
      />
    </div>
  )
}

export function PageSearchToggleButton({
  active,
  hasQuery,
  onClick,
  isDark,
  className,
}: {
  active: boolean
  hasQuery: boolean
  onClick: () => void
  isDark?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Close search" : "Search projects"}
      aria-expanded={active}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors",
        isDark
          ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        hasQuery && !active && (isDark ? "border-[#4be277]/50 text-[#4be277]" : "border-blue-400 text-blue-500"),
        active && (isDark ? "border-[#4be277]/50 bg-[#4be277]/10 text-[#4be277]" : "border-blue-400 bg-blue-50 text-blue-600"),
        className,
      )}
    >
      <Search className="h-4 w-4" />
    </button>
  )
}

export function PageSearchDismissButton({
  onClick,
  isDark,
}: {
  onClick: () => void
  isDark?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close search"
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors",
        isDark
          ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
      )}
    >
      <X className="h-4 w-4" />
    </button>
  )
}
