"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Member } from "@/features/timesheets/components/approvals/types"

interface MemberMultiSelectProps {
  members: Member[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export function MemberMultiSelect({ members, selected, onChange }: MemberMultiSelectProps) {
  const [open, setOpen] = useState(false)

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
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        <span className={cn(selectedMembers.length === 0 && "text-slate-400")}>
          {selectedMembers.length === 0
            ? "Select members"
            : `${selectedMembers.length} member${selectedMembers.length !== 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full mt-1 z-20 w-full bg-white rounded-xl border border-slate-200 shadow-lg py-1 max-h-48 overflow-y-auto"
            >
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: member.color }}
                  >
                    {member.avatar}
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <div className="text-slate-700">{member.name}</div>
                  </div>
                  <div
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                      selected.includes(member.id)
                        ? "bg-blue-500 border-blue-500"
                        : "border-slate-300"
                    )}
                  >
                    {selected.includes(member.id) && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
