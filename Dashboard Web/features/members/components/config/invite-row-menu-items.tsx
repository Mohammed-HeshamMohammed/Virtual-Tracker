"use client"

import type { ReactNode } from "react"
import { Copy, Mail, Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { Invite, InviteRowAction } from "@/features/members/models/member"

export type InviteRowMenuItem = {
  id: InviteRowAction
  label: string
  danger?: boolean
  icon: ReactNode
}

const ACTIVE_INVITE_STATUSES = new Set(["Pending", "Awaiting signup", "Pending sign-in"])

export function inviteRowMenuItems(invite: Invite): InviteRowMenuItem[] {
  const isPendingAccount = invite.listKind === "pending_account"
  const isExpired = invite.status === "Expired"
  const isActive = ACTIVE_INVITE_STATUSES.has(invite.status)

  if (isPendingAccount) {
    return [{ id: "delete", label: "Delete", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true }]
  }

  const items: InviteRowMenuItem[] = []

  if (isActive || isExpired) {
    items.push({ id: "resend-email", label: "Resend email", icon: <Mail className="h-3.5 w-3.5" /> })
    items.push({ id: "copy-link", label: "Copy invite link", icon: <Copy className="h-3.5 w-3.5" /> })
  }

  if (isExpired) {
    items.push({ id: "renew", label: "Renew invite", icon: <RefreshCw className="h-3.5 w-3.5" /> })
  }

  items.push({ id: "edit", label: "Edit invite", icon: <Pencil className="h-3.5 w-3.5" /> })

  if (isActive || isExpired) {
    items.push({ id: "delete", label: "Delete", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true })
  }

  return items
}

export function inviteDeleteConfirmMessage(invite: Invite): string {
  if (invite.listKind === "pending_account") {
    return `Delete pending account for ${invite.email}? This removes the Auth user and cannot be undone.`
  }
  return `Delete invite for ${invite.email}? This cannot be undone.`
}

export function inviteActionBusyLabel(action: InviteRowAction): string {
  switch (action) {
    case "resend-email":
      return "Sending…"
    case "copy-link":
      return "Copying…"
    case "renew":
      return "Renewing…"
    case "delete":
      return "Deleting…"
    default:
      return "Working…"
  }
}
