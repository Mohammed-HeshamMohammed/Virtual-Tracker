"use client"

import { useState } from "react"
import { Plus, Loader2, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover"
import { Avatar } from "@/shared/ui/avatar"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { useAuth } from "@/shared/providers/app"
import { canMigrateMembers } from "@/features/auth"
import { initialsFromName, memberAvatarColor } from "@/features/members/utils/build-tree"
import { fetchMigratableUsers, migrateAuthUsers } from "@/features/members/api/member-api"
import type { MigratableAuthUser } from "@/features/members/models/member"
import { createClientWithDetails } from "@/features/clients/api/client-api"
import { emptyClient } from "@/features/clients/utils"
import {
  ClientMemberInvitePanel,
  emptyClientMemberDraft,
  isClientMemberDraftComplete,
  clientMemberDraftDisplayName,
  clientMemberDraftEmail,
  type ClientMemberDraft,
} from "@/features/clients/components/modals/client-modal/client-member-invite-panel"
import { provisionClientMemberFromDraft } from "@/features/clients/services/client-member-provision"
import { SegmentedControl } from "@/features/clients/components/modals/client-modal/animated-primitives"

type QuickAddTab = "new" | "mobile"

export function QuickAddClientPopover({ onAdded }: { onAdded: (clientId: string) => void }) {
  const theme = useClientFormTheme()
  const { memberRole, user } = useAuth()
  const canMigrate = canMigrateMembers(memberRole ?? "")

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<QuickAddTab>("new")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<ClientMemberDraft>(() => emptyClientMemberDraft())

  const [mobileUsers, setMobileUsers] = useState<MigratableAuthUser[]>([])
  const [mobileLoadedOnce, setMobileLoadedOnce] = useState(false)
  const [mobileLoading, setMobileLoading] = useState(false)
  const [mobileNextPageToken, setMobileNextPageToken] = useState<string | null>(null)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [mobileFilterText, setMobileFilterText] = useState("")
  const [showAllRoles, setShowAllRoles] = useState(false)

  function reset() {
    setTab("new")
    setSaving(false)
    setError(null)
    setDraft(emptyClientMemberDraft())
    setSelectedUid(null)
    setMobileFilterText("")
    setShowAllRoles(false)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function loadMobileUsers() {
    if (mobileLoadedOnce) return
    setMobileLoadedOnce(true)
    setMobileLoading(true)
    fetchMigratableUsers()
      .then(({ users, nextPageToken }) => {
        setMobileUsers(users)
        setMobileNextPageToken(nextPageToken)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load mobile-app accounts."))
      .finally(() => setMobileLoading(false))
  }

  function loadMoreMobileUsers() {
    if (!mobileNextPageToken || mobileLoading) return
    setMobileLoading(true)
    fetchMigratableUsers({ pageToken: mobileNextPageToken })
      .then(({ users, nextPageToken }) => {
        setMobileUsers((prev) => [...prev, ...users])
        setMobileNextPageToken(nextPageToken)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load more accounts."))
      .finally(() => setMobileLoading(false))
  }

  function handleTabChange(next: QuickAddTab) {
    setTab(next)
    setError(null)
    if (next === "mobile") loadMobileUsers()
  }

  async function handleSaveNewContact() {
    if (!isClientMemberDraftComplete(draft)) {
      setError("Enter a valid email (and first/last name, for a full account) first.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const provisioned = await provisionClientMemberFromDraft(draft, { createdByUid: user?.uid })
      const created = await createClientWithDetails({
        ...emptyClient(),
        name: clientMemberDraftDisplayName(draft) || provisioned.displayName,
        email: clientMemberDraftEmail(draft) || provisioned.email,
      })
      onAdded(created.id)
      handleOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add client.")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveFromMobile() {
    if (!selectedUid) {
      setError("Select a mobile-app account first.")
      return
    }
    const picked = mobileUsers.find((u) => u.uid === selectedUid)
    if (!picked) return
    setSaving(true)
    setError(null)
    try {
      const results = await migrateAuthUsers([{ uid: picked.uid, role: "Client" }])
      const result = results[0]
      if (!result?.success || !result.memberId) {
        throw new Error(result?.error || "Migration failed.")
      }
      const created = await createClientWithDetails({
        ...emptyClient(),
        clientMember: result.memberId,
        name: picked.displayName || picked.email,
        email: picked.email,
      })
      onAdded(created.id)
      handleOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add client.")
    } finally {
      setSaving(false)
    }
  }

  const needle = mobileFilterText.trim().toLowerCase()
  const roleFiltered = showAllRoles ? mobileUsers : mobileUsers.filter((u) => u.suggestedRole === "Client")
  const visibleMobileUsers = needle
    ? roleFiltered.filter((u) => u.email.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle))
    : roleFiltered

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex items-center gap-1 text-xs font-semibold", theme.accent.link)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add client
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("z-[100] w-96 max-w-[calc(100vw-2rem)] space-y-4 p-4", theme.modal.panel)}
      >
        <SegmentedControl
          value={tab}
          onChange={handleTabChange}
          options={
            canMigrate
              ? [
                  { id: "new" as const, label: "New contact" },
                  { id: "mobile" as const, label: "From mobile app" },
                ]
              : [{ id: "new" as const, label: "New contact" }]
          }
          trackClassName={theme.isDark ? "bg-[#191f31]" : "bg-slate-100"}
          pillClassName={theme.isDark ? "bg-[#151b2d]" : "bg-white"}
          buttonClassName={(active) =>
            cn("px-3 py-1.5 text-xs font-semibold", active ? theme.bodyText : theme.mutedText)
          }
        />

        {error ? <p className="text-xs text-red-500">{error}</p> : null}

        {tab === "new" ? (
          <ClientMemberInvitePanel draft={draft} onChange={setDraft} />
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className={cn("pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2", theme.isDark ? "text-[#bccbb9]/60" : "text-slate-400")} />
              <input
                type="text"
                value={mobileFilterText}
                onChange={(e) => setMobileFilterText(e.target.value)}
                placeholder="Filter by email or name"
                aria-label="Filter by email or name"
                className={cn(theme.control, "pl-8")}
              />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={showAllRoles}
                onChange={(e) => setShowAllRoles(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
              <span className={theme.mutedText}>Show accounts not suggested as Client</span>
            </label>

            <div className={cn("max-h-64 overflow-y-auto scrollbar-hide rounded-lg border", theme.isDark ? "border-[#3d4a3d]/40" : "border-slate-200")}>
              {mobileLoading && mobileUsers.length === 0 ? (
                <div className={cn("flex items-center justify-center gap-2 py-6 text-xs", theme.mutedText)}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading...
                </div>
              ) : visibleMobileUsers.length === 0 ? (
                <div className={cn("py-6 text-center text-xs", theme.mutedText)}>
                  {mobileUsers.length === 0 ? "No unlinked mobile-app accounts found." : "No matches."}
                </div>
              ) : (
                visibleMobileUsers.map((u) => {
                  const displayName = u.displayName || u.email || u.uid
                  const selected = selectedUid === u.uid
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => setSelectedUid(u.uid)}
                      className={cn(
                        "flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0 transition-colors",
                        theme.isDark ? "border-[#3d4a3d]/40" : "border-slate-100",
                        selected ? theme.accent.selectedBg : theme.isDark ? "hover:bg-[#2e3447]/60" : "hover:bg-slate-50",
                      )}
                    >
                      <Avatar
                        initials={initialsFromName(displayName)}
                        color={memberAvatarColor(u.uid, false)}
                        imageUrl={u.avatarUrl}
                        alt={displayName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-xs font-medium", theme.bodyText)}>{displayName}</div>
                        {u.displayName && u.email ? <div className={cn("truncate text-[11px]", theme.hint)}>{u.email}</div> : null}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {mobileNextPageToken && !needle && (
              <button
                type="button"
                onClick={loadMoreMobileUsers}
                disabled={mobileLoading}
                className={cn("text-xs font-semibold", theme.accent.link)}
              >
                {mobileLoading ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", theme.footer.cancel)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void (tab === "new" ? handleSaveNewContact() : handleSaveFromMobile())}
            disabled={saving}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50", theme.accent.primarySolid)}
          >
            {saving ? "Adding…" : "Add client"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
