"use client"

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"

const POPOVER_WIDTH = 288
const POPOVER_EST_HEIGHT = 200
const VIEWPORT_PAD = 12

export type TaskPreviewAnchor = { x: number; y: number }

function clampAnchor(x: number, y: number): TaskPreviewAnchor {
  return {
    x: Math.max(
      VIEWPORT_PAD,
      Math.min(x, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD),
    ),
    y: Math.max(
      VIEWPORT_PAD,
      Math.min(y, window.innerHeight - POPOVER_EST_HEIGHT - VIEWPORT_PAD),
    ),
  }
}

function formatPreviewDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function TaskDetailPopover({
  open,
  anchor,
  title,
  description,
  startDate,
  dueDate,
  creatorName,
  isDark,
  onClose,
}: {
  open: boolean
  anchor: TaskPreviewAnchor | null
  title: string
  description: string
  startDate?: string | null
  dueDate?: string | null
  creatorName: string
  isDark: boolean
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const position = anchor ? clampAnchor(anchor.x, anchor.y) : null

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const onPointer = (event: globalThis.MouseEvent) => {
      const panel = panelRef.current
      if (panel && !panel.contains(event.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer)
    }, 0)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onPointer)
      window.clearTimeout(timer)
    }
  }, [open, onClose])

  if (typeof document === "undefined") return null

  const body = description.trim() || "No description provided."
  const startLabel = formatPreviewDate(startDate)
  const dueLabel = formatPreviewDate(dueDate)
  const hasDates = startLabel || dueLabel

  return createPortal(
    <AnimatePresence>
      {open && position ? (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={`Task details: ${title}`}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          style={{ left: position.x, top: position.y, width: POPOVER_WIDTH }}
          className={cn(
            "fixed z-100 rounded-xl border p-4 shadow-xl",
            isDark ? "border-[#2e3447] bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-900",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "absolute top-2.5 right-2.5 rounded-md p-1 transition-colors",
              isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-100",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <p className="pr-6 text-sm font-semibold leading-snug">{title}</p>
          <p className={cn("mt-1 text-[11px]", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            Created by {creatorName}
          </p>
          {hasDates ? (
            <p className={cn("mt-1 text-[11px]", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              {startLabel && dueLabel
                ? `${startLabel} – ${dueLabel}`
                : startLabel
                  ? `Starts ${startLabel}`
                  : `Due ${dueLabel}`}
            </p>
          ) : null}

          <div className={cn("my-3 h-px", isDark ? "bg-[#2e3447]" : "bg-slate-100")} />

          <p className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-wide", isDark ? "text-slate-400" : "text-slate-500")}>
            Description
          </p>
          <p
            className={cn(
              "scrollbar-hide max-h-36 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap",
              isDark ? "text-[#dce1fb]/90" : "text-slate-600",
              !description.trim() && "italic opacity-70",
            )}
          >
            {body}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

export function openTaskPreviewAtClick(
  task: { id: string },
  event: ReactMouseEvent,
  onOpen: (payload: { taskId: string; anchor: TaskPreviewAnchor }) => void,
) {
  event.preventDefault()
  event.stopPropagation()
  onOpen({
    taskId: task.id,
    anchor: { x: event.clientX, y: event.clientY },
  })
}
