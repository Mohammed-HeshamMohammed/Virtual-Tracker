"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { memberInitials, type OnlineMember, type UserStatus } from "@/features/dashboard/components/general/constants"

const statusColor: Record<UserStatus, string> = {
  Working: "bg-emerald-500",
  Idle: "bg-amber-500",
  Offline: "bg-slate-400",
}

export function MemberDetailDialog({
  member,
  onClose,
}: {
  member: OnlineMember | null
  onClose: () => void
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(90vh,24rem)] overflow-y-auto sm:max-w-md">
        {member ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <div className="relative shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-sm font-semibold text-slate-600">
                    {member.initials || memberInitials(member.name)}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${statusColor[member.status]}`}
                  />
                </div>
                <div className="min-w-0 text-left">
                  <DialogTitle className="text-left">{member.name}</DialogTitle>
                  <DialogDescription className="text-left">
                    {member.status} · {member.lastActive}
                    {member.project ? ` · ${member.project}` : ""}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            {member.time ? (
              <p className="text-sm text-slate-600">
                Session time: <span className="font-semibold text-slate-900">{member.time}</span>
              </p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
