"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FORM_SCROLL_HIDDEN, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

export type MultiSelectFieldOption = {
  label: string
  value: string
  meta?: React.ReactNode
}

const SEARCH_BAR_HEIGHT = 52
const OPTION_ROW_MIN_HEIGHT = 44
const VISIBLE_OPTION_ROWS = 4
const FLOATING_Z_INDEX = 20000

export function MultiSelectField({
  placeholder,
  options,
  selected,
  onChange,
  visibleOptionRows = VISIBLE_OPTION_ROWS,
}: {
  placeholder: string
  options: MultiSelectFieldOption[]
  selected: string[]
  onChange: (values: string[]) => void
  visibleOptionRows?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const theme = useClientFormTheme()
  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
  const listAreaMaxHeight = OPTION_ROW_MIN_HEIGHT * visibleOptionRows + 8
  const menuEstimatedHeight = SEARCH_BAR_HEIGHT + listAreaMaxHeight + 12
  const listRows = Math.min(filtered.length, visibleOptionRows) || 1
  const searchRows = Math.ceil(SEARCH_BAR_HEIGHT / OPTION_ROW_MIN_HEIGHT)
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    menuEstimatedHeight,
    listRows + searchRows,
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

  function toggle() {
    if (triggerRef.current) syncPosition()
    setOpen((v) => !v)
  }

  function getLabel(value: string): string {
    return options.find((o) => o.value === value)?.label ?? value
  }

  function toggleValue(value: string) {
    onChange(selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value])
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          theme.control,
          "flex h-auto min-h-10 items-start gap-2 py-2 text-left hover:bg-slate-50/80",
          open && theme.controlOpen,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className={theme.isDark ? "text-[#bccbb9]/70" : "text-slate-400"}>{placeholder}</span>
          ) : (
            selected.map((value) => (
              <span
                key={value}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  theme.isDark ? "bg-[#4be277]/15 text-[#4be277]" : "bg-blue-50 text-blue-600",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{getLabel(value)}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(selected.filter((x) => x !== value))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      onChange(selected.filter((x) => x !== value))
                    }
                  }}
                  className="shrink-0 rounded-full p-0.5 hover:bg-black/10"
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>
      {open &&
        menuStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "fixed flex flex-col overflow-hidden rounded-xl border shadow-lg",
              theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
            )}
            style={{
              top: menuStyle.top,
              left: menuStyle.left,
              minWidth: menuStyle.width,
              width: menuStyle.width,
              maxHeight: menuStyle.maxHeight,
              zIndex: FLOATING_Z_INDEX,
            }}
          >
            <div className={cn("shrink-0 border-b p-2", theme.isDark ? "border-[#3d4a3d]/40" : "border-slate-50")}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2",
                  theme.isDark
                    ? "bg-[#191f31] text-[#dce1fb] placeholder:text-[#bccbb9]/50 focus:ring-[#4be277]/20"
                    : "bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:ring-blue-500/20",
                )} aria-label="Interactive control"
              />
            </div>
            <div className={cn("min-h-0 flex-1 overflow-y-auto py-1", FORM_SCROLL_HIDDEN)} style={{ maxHeight: listMaxHeight }}>
              {filtered.length === 0 ? (
                <p className={cn("px-3 py-2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>
                  No results
                </p>
              ) : (
                filtered.map((opt, index) => {
                  const isSelected = selected.includes(opt.value)
                  return (
                    <button
                      key={`${String(opt.value ?? "")}-${index}`}
                      type="button"
                      onClick={() => toggleValue(opt.value)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                        theme.isDark ? "text-[#dce1fb] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-50",
                        isSelected && theme.accent.selectedBg,
                      )}
                      style={{ minHeight: OPTION_ROW_MIN_HEIGHT }}
                    >
                      <div
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                          isSelected
                            ? theme.isDark
                              ? "border-[#4be277] bg-[#4be277]"
                              : "border-blue-500 bg-blue-500"
                            : theme.isDark
                              ? "border-[#3d4a3d]/60"
                              : "border-slate-300",
                        )}
                      >
                        {isSelected ? <Check className="h-3 w-3 text-white" /> : null}
                      </div>
                      {opt.meta}
                      <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
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
