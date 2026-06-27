"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { TABLE_ROW_MENU_ITEM_BASE, tableRowMenuContentClass, tableRowMenuItemClass } from "@/shared/ui/layout/table-row-menu-styles"
import {
  inviteActionBusyLabel,
  inviteDeleteConfirmMessage,
  inviteRowMenuItems,
} from "@/features/members/components/config/invite-row-menu-items"
import type { Invite, InvitePatchBody, InviteRowAction } from "@/features/members/models/member"
import { InviteManageModal } from "@/features/members/components/modals/invite-manage-modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"

export function InviteRowActionsMenu({
  invite,
  onPatchInvite,
  onRemoveInvite,
  onResendInvite,
  onCopyInviteLink,
  onRenewInvite,
  onActionMessage,
  onNavigate,
  isDark = false,
}: {
  invite: Invite
  onPatchInvite: (id: string, body: InvitePatchBody) => Promise<void>
  onRemoveInvite: (id: string) => void | Promise<void>
  onResendInvite: (id: string) => Promise<{
    emailSent: boolean
    inviteUrl: string
    channel?: string
    emailError?: string
    emailDeliveryConfigured?: boolean
  }>
  onCopyInviteLink: (id: string) => Promise<string>
  onRenewInvite: (id: string) => Promise<void>
  onActionMessage?: (payload: { tone: "info" | "error"; message: string }) => void
  onNavigate?: (id: string) => void
  isDark?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<InviteRowAction | null>(null)

  const items = inviteRowMenuItems(invite)

  async function runAction(action: InviteRowAction) {
    if (busyAction) return
    setMenuOpen(false)

    if (action === "edit") {
      setManageOpen(true)
      return
    }

    if (action === "delete") {
      if (!window.confirm(inviteDeleteConfirmMessage(invite))) return
    }

    setBusyAction(action)
    try {
      if (action === "resend-email") {
        const result = await onResendInvite(invite.id)
        if (result.emailSent) {
          onActionMessage?.({ tone: "info", message: `Invite email resent to ${invite.email}.` })
        } else if (result.emailDeliveryConfigured || result.channel?.endsWith("_failed")) {
          const detail = result.emailError?.split("\n")[0] ?? "SMTP or Resend rejected the send."
          onActionMessage?.({
            tone: "info",
            message: result.inviteUrl
              ? `Email is configured but delivery failed (${detail}). Copy this link and send it manually:\n\n${result.inviteUrl}`
              : `Email delivery failed: ${detail}`,
          })
        } else {
          onActionMessage?.({
            tone: "info",
            message: result.inviteUrl
              ? `Email delivery is not configured. Copy this link and send it manually:\n\n${result.inviteUrl}`
              : "Email could not be sent. Configure RESEND_API_KEY or SMTP_* in Backend/.env.",
          })
        }
        return
      }

      if (action === "copy-link") {
        const link = await onCopyInviteLink(invite.id)
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(link)
        }
        onActionMessage?.({ tone: "info", message: "Invite link copied to clipboard." })
        return
      }

      if (action === "renew") {
        await onRenewInvite(invite.id)
        onActionMessage?.({ tone: "info", message: `Invite for ${invite.email} renewed.` })
        return
      }

      if (action === "delete") {
        await Promise.resolve(onRemoveInvite(invite.id))
        onActionMessage?.({ tone: "info", message: `Invite for ${invite.email} deleted.` })
      }
    } catch (e) {
      onActionMessage?.({
        tone: "error",
        message: e instanceof Error ? e.message : "Action failed.",
      })
    } finally {
      setBusyAction(null)
    }
  }

  if (items.length === 0) {
    return <span className="inline-flex h-7 w-7" />
  }

  return (
    <div className="relative">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busyAction != null}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium shadow-sm transition-colors disabled:opacity-60",
              isDark ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {busyAction ? inviteActionBusyLabel(busyAction) : "Actions"}
            <ChevronDown className={cn("h-3.5 w-3.5", isDark ? "text-[#bccbb9]" : "text-slate-500")} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={tableRowMenuContentClass(isDark, "w-48")}>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              disabled={busyAction != null}
              onClick={(e) => {
                e.stopPropagation()
                void runAction(item.id)
              }}
              className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(item.danger, isDark))}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <InviteManageModal
        open={manageOpen}
        openEntry="edit-info"
        invite={invite}
        onClose={() => setManageOpen(false)}
        onPatchInvite={onPatchInvite}
        onRemoveInvite={onRemoveInvite}
        onNavigate={onNavigate}
      />
    </div>
  )
}
