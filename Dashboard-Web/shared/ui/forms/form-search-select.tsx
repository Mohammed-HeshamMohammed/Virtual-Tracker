"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FORM_SCROLL_HIDDEN, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { FLOATING_MENU_ATTR } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

export type FormSearchSelectOption = {
  value: string
  label: string
  /** Extra text the search also matches (e.g. a zone id written with underscores). */
  keywords?: string
}

const SEARCH_BAR_HEIGHT = 52
const OPTION_ROW_HEIGHT = 40
const VISIBLE_OPTION_ROWS = 7
const FLOATING_Z_INDEX = 20000
const MIN_MENU_WIDTH = 320

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_/]+/g, " ")
}

/**
 * A single-select dropdown with a search box, styled like MultiSelectField so
 * long lists (time zones) can be filtered instead of scrolled. Typing filters,
 * Up/Down moves, Enter picks, Escape closes.
 */
export function FormSearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
  searchPlaceholder = "Search",
  disabled = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: FormSearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const theme = useClientFormTheme()

  const filtered = useMemo(() => {
    const tokens = normalize(search).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return options
    return options.filter((o) => {
      const haystack = normalize(`${o.label} ${o.keywords ?? ""}`)
      return tokens.every((t) => haystack.includes(t))
    })
  }, [options, search])

  const selected = options.find((o) => o.value === value)
  const listAreaMaxHeight = OPTION_ROW_HEIGHT * VISIBLE_OPTION_ROWS + 8
  const menuEstimatedHeight = SEARCH_BAR_HEIGHT + listAreaMaxHeight + 12
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    menuEstimatedHeight,
    Math.min(filtered.length, VISIBLE_OPTION_ROWS) + 2,
  )
  const listMaxHeight = menuStyle
    ? Math.min(listAreaMaxHeight, Math.max(100, menuStyle.maxHeight - SEARCH_BAR_HEIGHT))
    : listAreaMaxHeight

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  // Opening starts on the current value, with an empty search and focus in it.
  useEffect(() => {
    if (!open) return
    setSearch("")
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [search])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open, menuStyle])

  function toggle() {
    if (disabled) return
    if (triggerRef.current) syncPosition()
    setOpen((v) => !v)
  }

  function pick(next: string) {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const option = filtered[active]
      if (option) pick(option.value)
    } else if (e.key === "Escape") {
      // Close just this menu - not the modal it sits in.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const menuWidth = menuStyle ? Math.max(menuStyle.width, MIN_MENU_WIDTH) : MIN_MENU_WIDTH
  const menuLeft = menuStyle
    ? Math.max(8, Math.min(menuStyle.left, (typeof window !== "undefined" ? window.innerWidth : 0) - menuWidth - 8))
    : 0

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          theme.control,
          "flex items-center justify-between gap-2 text-left hover:bg-slate-50/80",
          theme.isDark && "hover:bg-[#2e3447]/80",
          open && theme.controlOpen,
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && (theme.isDark ? "text-[#bccbb9]/70" : "text-slate-400"))}>
          {selected?.label ?? (value || placeholder)}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        menuStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            {...{ [FLOATING_MENU_ATTR]: "" }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "fixed flex flex-col overflow-hidden rounded-xl border shadow-lg",
              theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
            )}
            style={{
              top: menuStyle.top,
              left: menuLeft,
              width: menuWidth,
              maxHeight: menuStyle.maxHeight,
              zIndex: FLOATING_Z_INDEX,
            }}
          >
            <div className={cn("border-b p-2", theme.isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
              <div className="relative">
                <Search
                  className={cn(
                    "pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
                    theme.isDark ? "text-[#bccbb9]/60" : "text-slate-400",
                  )}
                />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className={cn(
                    "w-full rounded-lg py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2",
                    theme.isDark
                      ? "bg-[#191f31] text-[#dce1fb] placeholder:text-[#bccbb9]/50 focus:ring-[#4be277]/20"
                      : "bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:ring-blue-500/20",
                  )}
                />
              </div>
            </div>
            <div
              ref={listRef}
              role="listbox"
              className={cn("min-h-0 flex-1 overflow-y-auto py-1", FORM_SCROLL_HIDDEN)}
              style={{ maxHeight: listMaxHeight }}
            >
              {filtered.length === 0 ? (
                <p className={cn("px-3 py-2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>No results</p>
              ) : (
                filtered.map((opt, index) => {
                  const isSelected = opt.value === value
                  return (
                    <button
                      key={opt.value || `__empty-${index}`}
                      type="button"
                      role="option"
                      data-index={index}
                      aria-selected={isSelected}
                      onClick={() => pick(opt.value)}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                        theme.isDark ? "text-[#dce1fb]" : "text-slate-600",
                        index === active && (theme.isDark ? "bg-[#2e3447]" : "bg-slate-50"),
                        isSelected && theme.accent.selectedBg,
                      )}
                      style={{ minHeight: OPTION_ROW_HEIGHT }}
                    >
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {isSelected ? <Check className={cn("h-3.5 w-3.5 shrink-0", theme.accent.check)} /> : null}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
