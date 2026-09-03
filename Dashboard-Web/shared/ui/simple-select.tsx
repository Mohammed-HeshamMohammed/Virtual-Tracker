"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { createPortal } from "react-dom"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PORTAL_DROPDOWN_BACKDROP_Z, PORTAL_DROPDOWN_MENU_Z } from "@/features/members/config/members-config"

const MENU_OPTION_ROW_CLASS = "w-full flex items-center justify-between px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 transition-colors"
const MENU_SCROLL_HIDDEN =
  "overflow-y-auto overscroll-y-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"

function normalizeOptions(options: string[]): string[] {
  if (!Array.isArray(options)) return []
  return options
    .map((option) => (typeof option === "string" ? option.trim() : String(option ?? "")))
    .filter((option) => option.length > 0)
}

export function SimpleSelect({
  value,
  onChange,
  options,
  portalToBody = false,
  disabled = false,
  menuMaxVisibleItems,
  isDark = false,
  size = "default",
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  portalToBody?: boolean
  disabled?: boolean
  menuMaxVisibleItems?: number
  isDark?: boolean
  size?: "default" | "compact"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 })
  const safeOptions = useMemo(() => normalizeOptions(options), [options])
  const displayValue = typeof value === "string" ? value : String(value ?? "")

  const optionRowClass = isDark
    ? "w-full flex items-center justify-between px-3 py-2 text-sm text-[#dce1fb] hover:bg-[#2e3447] transition-colors"
    : MENU_OPTION_ROW_CLASS
  const menuSurfaceClass = isDark
    ? "bg-[#191f31] border-[#3d4a3d]/40 shadow-xl"
    : "bg-white border-slate-100 shadow-lg"
  const checkClass = isDark ? "text-[#4be277]" : "text-blue-500"
  const triggerClass = cn(
    "flex w-full items-center justify-between gap-2 rounded-lg border text-sm transition-colors",
    size === "compact" ? "px-3 py-2" : "px-3 py-2.5",
    isDark
      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb] hover:border-[#4be277]/40"
      : "border-slate-200 bg-white text-slate-700 hover:border-blue-400",
    disabled ? "cursor-not-allowed opacity-60" : "",
  )
  const chevronClass = isDark ? "text-[#bccbb9]" : "text-slate-400"

  const handleToggle = () => {
    if (disabled) return
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && portalToBody && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      })
    }
  }

  useEffect(() => {
    if (!open || !portalToBody) return

    const updatePosition = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      })
    }

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, portalToBody])

  const menuListStyle =
    menuMaxVisibleItems && menuMaxVisibleItems > 0
      ? { maxHeight: `calc(${menuMaxVisibleItems} * 2.25rem)` }
      : undefined
  const menuListClass = menuMaxVisibleItems && menuMaxVisibleItems > 0 ? MENU_SCROLL_HIDDEN : undefined

  const optionButtons = safeOptions.map((o) => (
    <button
      key={o}
      onClick={() => {
        onChange(o)
        setOpen(false)
      }}
      className={optionRowClass}
      type="button"
    >
      {o}
      {o === displayValue && <Check className={cn("h-3.5 w-3.5", checkClass)} />}
    </button>
  ))

  const portalMenu =
    open && portalToBody && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            <motion.div
              key="simple-select-portal-menu"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1 }}
              className={cn("fixed inset-0 pointer-events-none", PORTAL_DROPDOWN_BACKDROP_Z)}
            >
              <div className="absolute inset-0 pointer-events-auto" aria-hidden onClick={() => setOpen(false)} />
              <motion.div
                className={cn(
                  "fixed pointer-events-auto rounded-xl border py-1",
                  menuSurfaceClass,
                  PORTAL_DROPDOWN_MENU_Z,
                )}
                style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              >
                <div className={menuListClass} style={menuListStyle}>
                  {optionButtons}
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null

  return (
    <div className={cn("relative", className)} ref={triggerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={triggerClass}
      >
        <span className="truncate">{displayValue}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0", chevronClass)} />
      </button>
      {portalMenu}
      {!portalToBody && (
        <AnimatePresence>
          {open && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setOpen(false)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.currentTarget.click()
                  }
                }}
              />
              <motion.div
                key="simple-select-inline-menu"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className={cn("absolute left-0 top-full z-20 mt-1 w-full rounded-xl border py-1", menuSurfaceClass)}
              >
                <div className={menuListClass} style={menuListStyle}>
                  {optionButtons}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
