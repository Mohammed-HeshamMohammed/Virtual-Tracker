"use client"

import type { ReactNode } from "react"
import { Ban, Clock, CreditCard, GitBranch, KeyRound, Settings2, Trash2, Users } from "lucide-react"
import type { MemberEntryAction } from "@/features/members/models/member"

export const MEMBER_ENTRY_ITEMS: {
  id: MemberEntryAction
  label: string
  danger?: boolean
  icon: ReactNode
}[] = [
  { id: "edit-info", label: "Manage options", icon: <Settings2 className="h-3.5 w-3.5" /> },
  { id: "edit-role", label: "Edit role and memberships", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "edit-payment", label: "Edit payment details", icon: <CreditCard className="h-3.5 w-3.5" /> },
  { id: "edit-limits", label: "Edit limits", icon: <Clock className="h-3.5 w-3.5" /> },
  { id: "disable-tracking", label: "Disable tracking", icon: <Ban className="h-3.5 w-3.5" /> },
  { id: "reset-password", label: "Reset password", icon: <KeyRound className="h-3.5 w-3.5" /> },
  { id: "remove-from-tree", label: "Remove from tree", icon: <GitBranch className="h-3.5 w-3.5" />, danger: true },
  { id: "remove-member", label: "Remove member", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true },
]
