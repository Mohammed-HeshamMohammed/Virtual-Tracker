"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Member } from "@/features/timesheets/components/approvals/types"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"

interface MemberMultiSelectProps {
  members: Member[]
  selected: string[]
  onChange: (ids: string[]) => void
}

/** What max-h-48 was before this menu started positioning itself against the
 *  viewport - kept as the ceiling so a long roster still scrolls rather than
 *  filling the screen. */
const MAX_MENU_HEIGHT = 192

export function MemberMultiSelect({ members, selected, onChange }: MemberMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Same reason as SelectField: absolute positioning left this list clipped
  // by the overflow-hidden panel of whatever dialog it sits in.
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    MAX_MENU_HEIGHT,
    members.length,
  )

  const toggleMember = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  const selectedMembers = members.filter((m) => selected.includes(m.id))

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (triggerRef.current) syncPosition()
          setOpen((v) => !v)
        }}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
      >
        <span className={cn(selectedMembers.length === 0 && "text-slate-400 dark:text-slate-500")}>
          {selectedMembers.length === 0
            ? "Select members"
            : `${selectedMembers.length} member${selectedMembers.length !== 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && menuStyle && (
              <div className={cn("fixed inset-0 pointer-events-none", FLOATING_MENU_Z_CLASS)}>
                <div className="absolute inset-0 pointer-events-auto" aria-hidden onMouseDown={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  {...{ [FLOATING_MENU_ATTR]: "" }}
                  className="pointer-events-auto fixed overflow-y-auto custom-scrollbar bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg py-1"
                  style={{
                    top: menuStyle.top,
                    left: menuStyle.left,
                    width: menuStyle.width,
                    maxHeight: menuStyle.maxHeight,
                  }}
                >
                  {members.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No members to choose from</p>
                  ) : (
                    members.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleMember(member.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                          style={{ backgroundColor: member.color }}
                        >
                          {member.avatar}
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <div className="text-slate-700 dark:text-slate-200">{member.name}</div>
                        </div>
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                            selected.includes(member.id)
                              ? "bg-emerald-500 border-emerald-500"
                              : "border-slate-300 dark:border-slate-600"
                          )}
                        >
                          {selected.includes(member.id) && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </button>
                    ))
                  )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
