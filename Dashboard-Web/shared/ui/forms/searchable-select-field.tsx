"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { FORM_SCROLL_HIDDEN } from "@/shared/ui/forms/form-styles"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

export type SearchableSelectOption = {
  value: string | null
  label: string
  meta?: ReactNode
}

const SEARCH_BAR_HEIGHT = 52
const OPTION_ROW_MIN_HEIGHT = 40
const VISIBLE_OPTION_ROWS = 4

export function SearchableSelectField({
  value,
  onChange,
  options,
  placeholder,
  isDark = false,
  clearable = false,
  className,
  menuMinWidth = 0,
  visibleOptionRows = VISIBLE_OPTION_ROWS,
  truncateOptions = true,
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: SearchableSelectOption[]
  placeholder: string
  isDark?: boolean
  clearable?: boolean
  className?: string
  menuMinWidth?: number
  visibleOptionRows?: number
  truncateOptions?: boolean
}) {
  const t = isDark ? dark : light
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)
  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
  const listRows = Math.min(Math.max(filtered.length, 1), visibleOptionRows)
  const listAreaMaxHeight = OPTION_ROW_MIN_HEIGHT * visibleOptionRows + 8
  const menuEstimatedHeight = SEARCH_BAR_HEIGHT + listAreaMaxHeight + 12
  const searchRows = Math.ceil(SEARCH_BAR_HEIGHT / OPTION_ROW_MIN_HEIGHT)
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    menuEstimatedHeight,
    listRows + searchRows,
    menuMinWidth,
  )
  const listMaxHeight = menuStyle
    ? Math.min(listAreaMaxHeight, Math.max(100, menuStyle.maxHeight - SEARCH_BAR_HEIGHT))
    : listAreaMaxHeight

  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  function toggle() {
    if (triggerRef.current) syncPosition()
    setOpen((v) => !v)
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          t.searchWrap,
          isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50",
          open && (isDark ? "ring-1 ring-[#4be277]/30" : "ring-1 ring-blue-200"),
        )}
      >
        {selected?.meta}
        <span className={cn("min-w-0 flex-1 truncate text-left", t.searchInput)}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", t.searchIcon, open && "rotate-180")}
        />
      </button>
      {open &&
        menuStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={cn("fixed inset-0 pointer-events-none", FLOATING_MENU_Z_CLASS)}>
            <div
              className="absolute inset-0 pointer-events-auto"
              aria-hidden
              onMouseDown={() => setOpen(false)}
            />
            <div
              ref={menuRef}
              {...{ [FLOATING_MENU_ATTR]: "" }}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                "pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border shadow-lg",
                isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
              )}
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                minWidth: menuStyle.width,
                width: menuStyle.width,
                maxHeight: menuStyle.maxHeight,
              }}
            >
            <div className={cn("shrink-0 border-b p-2", isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2",
                  isDark
                    ? "bg-[#191f31] text-[#dce1fb] placeholder:text-[#bccbb9]/50 focus:ring-[#4be277]/20"
                    : "bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:ring-blue-500/20",
                )} aria-label="Interactive control"
              />
            </div>
            <div className={cn("min-h-0 flex-1 overflow-y-auto py-1", FORM_SCROLL_HIDDEN)} style={{ maxHeight: listMaxHeight }}>
              {clearable && value !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-xs transition-colors",
                    isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-50",
                  )}
                >
                  Clear
                </button>
              ) : null}
              {filtered.length === 0 ? (
                <p className={cn("px-3 py-2 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-400")}>No results</p>
              ) : (
                filtered.map((opt, index) => (
                  <button
                    key={`${String(opt.value ?? "")}-${index}`}
                    type="button"
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                      isDark ? "text-[#dce1fb] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-50",
                      opt.value === value && (isDark ? "bg-[#4be277]/10" : "bg-blue-50"),
                    )}
                    style={{ minHeight: OPTION_ROW_MIN_HEIGHT }}
                  >
                    {opt.meta}
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-left",
                        truncateOptions ? "truncate" : "whitespace-normal leading-snug",
                      )}
                    >
                      {opt.label}
                    </span>
                    {opt.value === value ? (
                      <Check className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-[#4be277]" : "text-blue-500")} />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
