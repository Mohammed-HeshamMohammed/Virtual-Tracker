"use client"

import type { AddMembersResult, AddMembersSubmission, Invite, InvitePatchBody, Member, MemberPatchBody, MemberRole } from "@/features/members/models/member"
import {
  createInvitesBulk,
  createOpenInviteLink,
  deleteInvite,
  deleteMember,
  batchDeleteMembers,
  batchRemoveMembersFromTree,
  batchUpdateMembers,
  removeMemberFromTree,
  getMembers,
  getInviteLink,
  getInvites,
  invalidateMemberProfileCache,
  migrateAuthUsers,
  preprovisionMember,
  renewInvite,
  resendInviteEmail,
  updateInvite,
  updateMember,
  updateMemberProfile,
  type BatchMemberUpdatePayload,
  type MemberProfilePayload,
} from "@/infrastructure/api"
import { isOwnerRoleName } from "@/features/auth"
import { isSameMember } from "@/features/members/utils/member-utils"

interface UseMemberMutationsProps {
  user: any
  currentMemberId?: string
  setMembers: (value: Member[] | ((prev: Member[]) => Member[])) => void
  setInvites: (value: Invite[] | ((prev: Invite[]) => Invite[])) => void
  canManageMembers: boolean
  canUseBatchMemberActions: boolean
  manageableMemberIds: Set<string>
  members: Member[]
  invites: Invite[]
  canSeeAllMembers: boolean
  membersListFields?: string[]
}

function canManageMemberRecord(
  memberId: string,
  manageableMemberIds: Set<string>,
  currentMemberId?: string,
): boolean {
  if (currentMemberId && memberId === currentMemberId) return true
  return manageableMemberIds.has(memberId)
}

function canManageInviteRecord(
  invite: Invite,
  userUid: string | undefined,
  canSeeAllMembers: boolean,
): boolean {
  if (canSeeAllMembers) return true
  if (!userUid) return false
  return invite.createdByUid === userUid
}

const BATCH_ACTIONS_DENIED_MESSAGE = "Batch member actions require Manager or higher privileges."

export function useMemberMutations({
  user,
  currentMemberId,
  setMembers,
  setInvites,
  canManageMembers,
  canUseBatchMemberActions,
  manageableMemberIds,
  members,
  invites,
  canSeeAllMembers,
  membersListFields,
}: UseMemberMutationsProps) {
  async function refreshMembersFromApi(): Promise<Member[]> {
    return getMembers(membersListFields?.length ? { fields: membersListFields } : {})
  }
  async function handleAddMembers(payload: AddMembersSubmission): Promise<AddMembersResult> {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    if (payload.mode === "invites") {
      const result = await createInvitesBulk(
        payload.rows.map((row) => ({ email: row.email, payRate: Number(row.payRate || 0) || undefined })),
        payload.role as any,
        { appOrigin: typeof window !== "undefined" ? window.location.origin : undefined, createdByUid: user?.uid },
      )
      if (result.invites.length) {
        setInvites((prev) => [...result.invites, ...prev])
      }
      return {
        mode: "invites",
        count: result.invites.length,
        emailsSent: result.emailsSent,
        emailsFailed: result.emailsFailed,
        inviteUrls: result.inviteUrls,
        emailChannel: result.emailChannel,
        emailConfigured: result.emailsSent > 0 || (result.emailChannel !== undefined && result.emailChannel !== "skipped"),
      }
    }

    if (payload.mode === "migrate") {
      const results = await migrateAuthUsers(payload.migrations)
      if (results.some((r) => r.success)) {
        const refreshed = await refreshMembersFromApi()
        setMembers(refreshed)
      }
      return { mode: "migrate", results }
    }

    const row = payload.rows[0]
    if (!row?.name || !row?.email) {
      return Promise.reject(new Error("Name and email are required."))
    }
    const provision = await preprovisionMember({
      name: row.name,
      email: row.email,
      role: payload.role,
      payRate: Number(row.payRate || 0) || undefined,
      sendWelcomeEmail: payload.sendWelcomeEmail,
      createdByUid: user?.uid,
    })
    const nextInvites = await getInvites()
    setInvites(nextInvites)
    return {
      mode: "accounts",
      email: row.email,
      emailSent: provision.emailSent,
      tempPassword: provision.tempPassword,
    }
  }

  async function handlePatchMember(id: string, body: MemberPatchBody) {
    const canPatch = canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    if (!canPatch) {
      console.error("[MembersPage] Permission denied: cannot edit member outside your manage scope")
      return Promise.reject(new Error("Permission denied"))
    }

    const updated = (await updateMember(id, body as any, "desktop-members")) as Member
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)))
    return updated
  }

  async function handleSaveProfile(id: string, payload: MemberProfilePayload, expectedUpdatedAt?: string) {
    const canPatch = canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    if (!canPatch) {
      console.error("[MembersPage] Permission denied: cannot edit member outside your manage scope")
      return Promise.reject(new Error("Permission denied"))
    }

    const { member: updated } = await updateMemberProfile(id, payload, "desktop-members", expectedUpdatedAt)
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)))
    return updated
  }

  async function handleRemoveMember(id: string) {
    if (!canManageMembers) {
      console.error("[MembersPage] Permission denied: member removal requires management role")
      return
    }
    const member = members.find((m) => m.id === id)
    if (!member) return

    if (isOwnerRoleName(member.role === "User" ? "Viewer" : member.role)) {
      console.error("[MembersPage] The Owner account cannot be removed")
      return Promise.reject(new Error("The Owner account cannot be removed through the application."))
    }

    if (isSameMember(member, currentMemberId, user?.uid, user?.email)) {
      console.error("[MembersPage] Use Remove Myself in Settings or Profile for self-removal")
      return
    }

    const canRemove = canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    if (!canRemove) {
      console.error("[MembersPage] Permission denied: cannot remove member outside your manage scope")
      return
    }

    await deleteMember(id)
    invalidateMemberProfileCache(id)
    setMembers((prev) => prev.filter((m) => m.id !== id))
  }

  async function handlePatchInvite(id: string, body: InvitePatchBody) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    const invite = invites.find((row) => row.id === id)
    if (!invite || !canManageInviteRecord(invite, user?.uid, canSeeAllMembers)) {
      return Promise.reject(new Error("Permission denied"))
    }
    const updated = (await updateInvite(id, body as any, "desktop-members")) as Invite
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated } : i)))
  }

  async function handleRemoveInvite(id: string) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    const invite = invites.find((row) => row.id === id)
    if (!invite || !canManageInviteRecord(invite, user?.uid, canSeeAllMembers)) {
      return Promise.reject(new Error("Permission denied"))
    }
    await deleteInvite(id)
    setInvites((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleResendInvite(id: string) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    const result = await resendInviteEmail(id)
    const nextInvites = await getInvites()
    setInvites(nextInvites)
    return result
  }

  async function handleCopyInviteLink(id: string) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    return getInviteLink(id)
  }

  async function handleRenewInvite(id: string) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    const updated = await renewInvite(id)
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated } : i)))
  }

  async function handleRemoveFromTree(id: string) {
    if (!canUseBatchMemberActions) {
      return Promise.reject(new Error(BATCH_ACTIONS_DENIED_MESSAGE))
    }
    const member = members.find((m) => m.id === id)
    if (!member) return

    if (isOwnerRoleName(member.role === "User" ? "Viewer" : member.role)) {
      return Promise.reject(new Error("The Owner account cannot be removed from the tree."))
    }

    if (isSameMember(member, currentMemberId, user?.uid, user?.email)) {
      return Promise.reject(new Error("Use Settings or Profile for self-removal."))
    }

    const canRemove = canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    if (!canRemove) {
      return Promise.reject(new Error("Permission denied"))
    }

    await removeMemberFromTree(id)
    invalidateMemberProfileCache(id)
    const refreshed = await refreshMembersFromApi()
    setMembers(refreshed)
  }

  async function handleBatchRemoveFromTree(ids: string[]) {
    if (!canUseBatchMemberActions) {
      return Promise.reject(new Error(BATCH_ACTIONS_DENIED_MESSAGE))
    }
    const allowedIds = ids.filter((id) => {
      const member = members.find((m) => m.id === id)
      if (!member) return false
      if (isOwnerRoleName(member.role === "User" ? "Viewer" : member.role)) return false
      if (isSameMember(member, currentMemberId, user?.uid, user?.email)) return false
      return canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    })

    if (allowedIds.length === 0) {
      return Promise.reject(new Error("No eligible members selected for removal from tree."))
    }

    await batchRemoveMembersFromTree(allowedIds)
    allowedIds.forEach((id) => invalidateMemberProfileCache(id))
    const refreshed = await refreshMembersFromApi()
    setMembers(refreshed)
  }

  async function handleRemoveMembers(ids: string[]) {
    if (!canUseBatchMemberActions) {
      return Promise.reject(new Error(BATCH_ACTIONS_DENIED_MESSAGE))
    }
    const allowedIds = ids.filter((id) => {
      const member = members.find((m) => m.id === id)
      if (!member) return false
      if (isOwnerRoleName(member.role === "User" ? "Viewer" : member.role)) return false
      if (isSameMember(member, currentMemberId, user?.uid, user?.email)) return false
      return canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    })

    if (allowedIds.length === 0) {
      return Promise.reject(new Error("No eligible members selected for removal."))
    }

    await batchDeleteMembers(allowedIds)
    allowedIds.forEach((id) => invalidateMemberProfileCache(id))
    setMembers((prev) => prev.filter((m) => !allowedIds.includes(m.id)))
  }

  async function handleBatchUpdateMembers(ids: string[], patch: BatchMemberUpdatePayload) {
    if (!canUseBatchMemberActions) {
      return Promise.reject(new Error(BATCH_ACTIONS_DENIED_MESSAGE))
    }
    const allowedIds = ids.filter((id) => {
      if (!members.some((m) => m.id === id)) return false
      return canManageMemberRecord(id, manageableMemberIds, currentMemberId)
    })
    if (allowedIds.length === 0) {
      return Promise.reject(new Error("No eligible members selected."))
    }
    await batchUpdateMembers(allowedIds, patch)
    allowedIds.forEach((id) => invalidateMemberProfileCache(id))
    const refreshed = await refreshMembersFromApi()
    setMembers(refreshed)
  }

  async function handleCreateShareLink(payload: { role: MemberRole }) {
    if (!canManageMembers) {
      return Promise.reject(new Error("Permission denied"))
    }
    const result = await createOpenInviteLink({
      role: payload.role as any,
      appOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      createdByUid: user?.uid,
    })
    const nextInvites = await getInvites()
    setInvites(nextInvites)
    return result
  }

  return {
    handleAddMembers,
    handleCreateShareLink,
    handlePatchMember,
    handleSaveProfile,
    handleRemoveMember,
    handleRemoveFromTree,
    handlePatchInvite,
    handleRemoveInvite,
    handleResendInvite,
    handleCopyInviteLink,
    handleRenewInvite,
    handleRemoveMembers,
    handleBatchRemoveFromTree,
    handleBatchUpdateMembers,
  }
}
