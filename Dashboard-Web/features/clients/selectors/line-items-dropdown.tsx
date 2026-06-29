"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { LINE_ITEM_GROUPS } from "@/features/projects/constants"

/** Two-line option row (label + example) with py-2.5 */
const LINE_ITEM_OPTION_ROW_REM = 3.625
const LINE_ITEM_GROUP_HEADER_REM = 1.75
const LINE_ITEM_MAX_VISIBLE_ROWS = 3

const LINE_ITEMS_MENU_SCROLL =
  "overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"

export function LineItemsDropdown({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = LINE_ITEM_GROUPS.flatMap((g) => g.items).find((i) => i.value === value)
  const theme = useClientFormTheme()

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open])

  function toggle() {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen((v) => !v)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(theme.control, "flex items-center justify-between hover:opacity-95", open && theme.controlOpen)}
      >
        <div className="text-left min-w-0">
          <div className="text-sm text-slate-700 truncate">{selected?.label ?? "Select line item format"}</div>
          {selected && <div className="text-xs text-slate-400 truncate">{selected.example}</div>}
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 shrink-0 ml-2 transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              "fixed rounded-xl border shadow-lg py-1",
              LINE_ITEMS_MENU_SCROLL,
              theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
            )}
            style={{
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: rect.width,
              width: rect.width,
              zIndex: 9999,
              maxHeight: `calc(${LINE_ITEM_GROUP_HEADER_REM}rem + ${LINE_ITEM_MAX_VISIBLE_ROWS} * ${LINE_ITEM_OPTION_ROW_REM}rem)`,
            }}
          >
            {LINE_ITEM_GROUPS.map((group) => (
              <div key={group.group}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-y border-slate-100 first:border-t-0">
                  {group.group}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      onChange(item.value)
                      setOpen(false)
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-start justify-between gap-2",
                      item.value === value && theme.accent.selectedBg,
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700">{item.label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{item.example}</div>
                    </div>
                    {item.value === value && <Check className={cn("mt-1 h-3.5 w-3.5 shrink-0", theme.accent.check)} />}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
