"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FORM_SCROLL_HIDDEN, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

export function SelectField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? options[0]?.label ?? "Select"
  const theme = useClientFormTheme()
  const menuHeightEstimate = Math.min(240, options.length * 40 + 16)
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    menuHeightEstimate,
    options.length,
  )

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
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          theme.control,
          "flex items-center justify-between hover:bg-slate-50/80",
          theme.isDark && "hover:bg-[#2e3447]/80",
          open && theme.controlOpen,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
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
              role="listbox"
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                "pointer-events-auto fixed overflow-y-auto rounded-xl border py-1 shadow-lg",
                FORM_SCROLL_HIDDEN,
                theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
              )}
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                minWidth: menuStyle.width,
                width: menuStyle.width,
                maxHeight: menuStyle.maxHeight,
              }}
            >
            {options.map((opt, index) => (
              <button
                key={opt.value || `__placeholder-${index}`}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors",
                  theme.isDark ? "text-[#dce1fb] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check className={cn("h-3.5 w-3.5 shrink-0", theme.accent.check)} />}
              </button>
            ))}
          </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
