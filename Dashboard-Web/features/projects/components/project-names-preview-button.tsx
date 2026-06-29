"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, FolderOpen } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FORM_SCROLL_HIDDEN, useClientFormTheme } from "@/shared/ui/forms/form-styles"

export function ProjectNamesPreviewButton({ names }: { names: string[] }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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

  if (names.length === 0) return null

  const countLabel = `${names.length} project${names.length === 1 ? "" : "s"} to create`

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
          theme.isDark
            ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#4be277] hover:bg-[#2e3447]"
            : "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100",
          open && (theme.isDark ? "ring-1 ring-[#4be277]/40" : "ring-1 ring-blue-400"),
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        {countLabel}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className={cn(
              "fixed max-h-52 rounded-xl border py-1 shadow-lg",
              FORM_SCROLL_HIDDEN,
              theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
            )}
            style={{
              top: rect.bottom + 4,
              left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8),
              minWidth: Math.max(rect.width, 220),
              width: Math.max(rect.width, 220),
              zIndex: 20000,
            }}
          >
            <p
              className={cn(
                "border-b px-3 py-2 text-[10px] font-bold uppercase tracking-wider",
                theme.isDark ? "border-[#3d4a3d]/40 text-[#bccbb9]" : "border-slate-100 text-slate-400",
              )}
            >
              Will be created
            </p>
            {names.map((name, index) => (
              <div
                key={`${name}-${index}`}
                role="option"
                aria-selected={false}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm",
                  theme.isDark ? "text-[#dce1fb]" : "text-slate-700",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    theme.isDark ? "bg-[#4be277]/20 text-[#4be277]" : "bg-blue-100 text-blue-600",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 truncate">{name}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
