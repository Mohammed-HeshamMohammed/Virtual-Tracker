"use client"

import { useState } from "react"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { isLimitedSelfManageRole } from "@/features/auth"
import { MEMBER_ENTRY_ITEMS } from "@/features/members/components/config/entry-menu-items"
import { PORTAL_DROPDOWN_MENU_Z } from "@/features/members/config/members-config"
import type { Member, MemberEntryAction, MemberPatchBody } from "@/features/members/models/member"
import { MemberManageModal } from "@/features/members/components/modals/member-manage"
import { MemberEntryModal, isFocusedMemberEntryAction } from "@/features/members/components/modals/member-entry-modal"
import { isSameMember, memberEntryToTab } from "@/features/members/utils/member-utils"
import type { MemberManageTab } from "@/features/members/models/member"
import {
  TABLE_ROW_MENU_ITEM_BASE,
  tableRowMenuContentClass,
  tableRowMenuItemClass,
} from "@/shared/ui/layout/table-row-menu-styles"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"

const LIMITED_SELF_TABS: MemberManageTab[] = ["info", "settings"]

export function MemberRowMenu({
  member,
  onPatchMember,
  onSaveProfile,
  onRemoveMember,
  onRemoveFromTree,
  onNavigate,
  allowedEntries,
  contextRequest, // Unused but kept for API compatibility if needed
  isDark = false,
  actorRole = "",
}: {
  member: Member
  onPatchMember: (id: string, body: MemberPatchBody) => Promise<Member | undefined>
  onSaveProfile?: (id: string, payload: import("@/features/members/api/member-api").MemberProfilePayload) => Promise<Member>
  onRemoveMember: (id: string) => void | Promise<void>
  onRemoveFromTree?: (id: string) => void | Promise<void>
  onNavigate?: (id: string) => void
  allowedEntries?: MemberEntryAction[]
  contextRequest?: { x: number; y: number; nonce: number } | null
  isDark?: boolean
  actorRole?: string
}) {
  const { memberId, memberRole, user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryAction, setEntryAction] = useState<MemberEntryAction | null>(null)

  const isSelf = isSameMember(member, memberId, user?.uid, user?.email ?? undefined)
  const limitedSelfManage = isSelf && isLimitedSelfManageRole(actorRole || memberRole)

  const entryIds = Array.isArray(allowedEntries)
    ? allowedEntries
    : MEMBER_ENTRY_ITEMS.map((item) => item.id)
  const entrySet = new Set(entryIds)
  const visibleEntries = MEMBER_ENTRY_ITEMS.filter((i) => entrySet.has(i.id)).map((item) =>
    item.id === "edit-info"
      ? { ...item, label: isSelf ? "Manage myself" : "Manage options" }
      : item,
  )
  const baseTabs = [...new Set(visibleEntries.map((i) => memberEntryToTab(i.id)))]
  const allowedTabs = limitedSelfManage ? LIMITED_SELF_TABS : baseTabs
  const canOpen = visibleEntries.length > 0

  return (
    <div className="relative">
      {canOpen ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Row actions"
              aria-label="Row actions"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors data-[state=open]:opacity-100",
                isDark
                  ? "text-[#bccbb9] hover:bg-[#2e3447] hover:text-[#dce1fb]"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={cn(tableRowMenuContentClass(isDark, "w-60"), PORTAL_DROPDOWN_MENU_Z)}
          >
            {visibleEntries.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  if (item.id === "edit-info") {
                    setManageOpen(true)
                  } else if (isFocusedMemberEntryAction(item.id)) {
                    setEntryAction(item.id)
                    setEntryOpen(true)
                  }
                }}
                className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(item.danger, isDark))}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="inline-flex h-7 w-7" />
      )}

      <MemberManageModal
        open={manageOpen}
        openEntry="edit-info"
        member={member}
        onClose={() => setManageOpen(false)}
        onPatchMember={onPatchMember}
        onSaveProfile={onSaveProfile}
        onRemoveMember={onRemoveMember}
        onNavigate={onNavigate}
        allowedTabs={allowedTabs}
        canSave={canOpen}
        actorRole={actorRole}
        limitedSelfManage={limitedSelfManage}
      />

      <MemberEntryModal
        open={entryOpen}
        action={entryAction}
        member={member}
        isDark={isDark}
        actorRole={actorRole}
        onClose={() => {
          setEntryOpen(false)
          setEntryAction(null)
        }}
        onPatchMember={onPatchMember}
        onSaveProfile={onSaveProfile}
        onRemoveMember={onRemoveMember}
        onRemoveFromTree={onRemoveFromTree}
      />
    </div>
  )
}
