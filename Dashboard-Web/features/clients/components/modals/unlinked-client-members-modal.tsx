/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Plus, X } from "lucide-react"
import type { Member } from "@/features/members/models/member"
import { MemberAvatar } from "@/features/projects/ui-components"

const ROW_HEIGHT_PX = 52
const VISIBLE_ROWS = 4

export function UnlinkedClientMembersModal({
  members,
  onClose,
  onAddMember,
}: {
  members: Member[]
  onClose: () => void
  onAddMember: (memberId: string) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Client members to add</h2>
            <p className="mt-1 text-sm text-slate-500">
              These people have the Client role on the Members page but are not in your clients list yet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="overflow-y-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: ROW_HEIGHT_PX * VISIBLE_ROWS }}
        >
          {members.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-6 py-10 text-center text-sm text-slate-400"
            >
              Everyone is up to date
            </motion.p>
          ) : (
            <AnimatePresence initial={false}>
              {members.map((member, index) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.16, delay: index * 0.03 }}
                  className="flex items-center gap-3 border-b border-slate-50 px-6 last:border-b-0"
                  style={{ height: ROW_HEIGHT_PX }}
                >
                  <MemberAvatar member={{ ...member, color: member.avatarColor || "#94a3b8" }} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{member.name}</p>
                    <p className="truncate text-xs text-slate-400">{member.email || "No email"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddMember(member.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100"
                    aria-label={`Add ${member.name} as client`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
