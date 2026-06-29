"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { Member } from "@/features/members/models/member"
import { FieldLabel } from "@/shared/ui/forms/field-label";
import { MemberAvatar } from "@/features/projects/ui-components"

const MEMBER_ROW_HEIGHT_PX = 52
const VISIBLE_MEMBER_ROWS = 4

export function ClientMemberSelector({
  selected,
  onChange,
  members,
  disabled = false,
}: {
  selected: string
  onChange: (memberId: string) => void
  members: Member[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedMember = members.find((m) => m.id === selected)

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
    <div className="space-y-2">
      <FieldLabel>Client member</FieldLabel>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          disabled={disabled}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50",
            open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200",
            disabled && "cursor-not-allowed opacity-60 hover:bg-white",
          )}
        >
          <span className="h-5 w-0.5 shrink-0 rounded-full bg-blue-400" />
          {selectedMember ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MemberAvatar member={{ ...selectedMember, color: selectedMember.avatarColor || "#94a3b8" }} size="sm" />
              <span className="truncate text-slate-700">{selectedMember.name}</span>
            </div>
          ) : (
            <span className="flex-1 truncate text-slate-500">Select a member</span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
        </button>
        {open &&
          rect &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={menuRef}
              className="fixed overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
              style={{
                top: rect.bottom + 4,
                left: rect.left,
                minWidth: rect.width,
                width: rect.width,
                zIndex: 9999,
              }}
            >
              <div
                className="overflow-y-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                style={{ maxHeight: MEMBER_ROW_HEIGHT_PX * VISIBLE_MEMBER_ROWS }}
              >
                {members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      onChange(member.id)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full shrink-0 items-center gap-3 px-3 text-sm transition-colors hover:bg-slate-50",
                      selected === member.id && "bg-blue-500/5",
                    )}
                    style={{ height: MEMBER_ROW_HEIGHT_PX }}
                  >
                    <MemberAvatar member={{ ...member, color: member.avatarColor || "#94a3b8" }} size="sm" />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-slate-700">{member.name}</div>
                      <div className="truncate text-xs text-slate-400">{member.email}</div>
                    </div>
                    {selected === member.id && <Check className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  )
}
