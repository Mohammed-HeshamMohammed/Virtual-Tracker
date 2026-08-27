/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { TOPBAR_THEME_DARK as dark, TOPBAR_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  buildAppSearchIndex,
  formatSearchEntryPath,
  getAccessiblePageIds,
  searchAppIndex,
  type AppSearchEntry,
} from "@/shared/search"

type GlobalSearchBarProps = {
  onNavigate: (pageId: string) => void
  memberRole: string
  activePageId: string
}

export function GlobalSearchBar({ onNavigate, memberRole, activePageId }: GlobalSearchBarProps) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light

  const [query, setQuery] = useComponentState("")
  const [open, setOpen] = useComponentState(false)
  const [highlightIndex, setHighlightIndex] = useComponentState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const index = useMemo(() => buildAppSearchIndex(), [])
  const accessiblePageIds = useMemo(() => getAccessiblePageIds(memberRole), [memberRole])

  const results = useMemo(
    () => searchAppIndex(index, query, accessiblePageIds),
    [index, query, accessiblePageIds],
  )

  const [prevActivePageId, setPrevActivePageId] = useComponentState(activePageId)
  const [prevQuery, setPrevQuery] = useComponentState(query)

  if (activePageId !== prevActivePageId) {
    setPrevActivePageId(activePageId)
    setQuery("")
    setOpen(false)
    setHighlightIndex(0)
  } else if (query !== prevQuery) {
    setPrevQuery(query)
    setHighlightIndex(0)
  }

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [])

  const navigateTo = useCallback(
    (entry: AppSearchEntry) => {
      onNavigate(entry.pageId)
      setQuery("")
      setOpen(false)
      setHighlightIndex(0)
      inputRef.current?.blur()
    },
    [onNavigate],
  )

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true)
      return
    }

    if (event.key === "Escape") {
      setOpen(false)
      setQuery("")
      return
    }

    if (results.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightIndex((i) => (i + 1) % results.length)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightIndex((i) => (i - 1 + results.length) % results.length)
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      const target = results[highlightIndex] ?? results[0]
      if (target) navigateTo(target)
    }
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <motion.div ref={rootRef} layout="position" className="relative w-72">
      <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-xl w-full transition-all", t.searchWrap)}>
        <Search className={cn("w-4 h-4 shrink-0", t.searchIcon)} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search pages, buttons, reports..."
          aria-label="Search the app"
          aria-expanded={showDropdown}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          role="combobox"
          className={cn("bg-transparent border-none focus:ring-0 text-sm w-full outline-none", t.searchInput)}
        />
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            id="global-search-results"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute left-0 right-0 top-[calc(100%+0.5rem)] z-100 max-h-80 overflow-y-auto rounded-xl py-1.5 shadow-xl",
              t.dropdown,
            )}
          >
            {results.length === 0 ? (
              <p className={cn("px-3 py-2.5 text-sm", t.dropItem)}>
                No pages match &ldquo;{query.trim()}&rdquo;
              </p>
            ) : (
              results.map((entry, index) => {
                const isActive = index === highlightIndex
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => navigateTo(entry)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors",
                      isActive ? t.dropItemActive : t.dropItem,
                    )}
                  >
                    <span className="text-sm font-semibold">{entry.title}</span>
                    <span className={cn("text-xs", t.dropHeadLabel)}>{formatSearchEntryPath(entry)}</span>
                    {entry.description ? (
                      <span className={cn("line-clamp-1 text-xs opacity-80", t.notifItemBody)}>
                        {entry.description}
                      </span>
                    ) : null}
                  </button>
                )
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
