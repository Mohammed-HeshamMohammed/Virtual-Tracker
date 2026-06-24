"use client"

import { ChevronRight, UserRound } from "lucide-react"

export function PendingClientMembersBanner({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}) {
  if (count <= 0) return null

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-left transition-colors hover:bg-blue-50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
        <UserRound className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">
          {count} client member{count !== 1 ? "s" : ""} not added yet
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Added on the Members page with the Client role — tap to review and add them here
        </p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-blue-500" />
    </button>
  )
}
