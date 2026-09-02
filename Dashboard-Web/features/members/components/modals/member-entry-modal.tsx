"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { isOwnerRoleName } from "@/features/auth"
import { canEditPayRates } from "@/features/auth/permissions/member-role-access"
import { sendFirebasePasswordResetEmail } from "@/features/auth/services/password-reset"
import { getMemberProfile, type MemberProfilePayload } from "@/features/members/api/member-api"
import { RolesTab, PayBillTab, WorkLimitsTab } from "@/features/members/components/modals/member-manage/tabs"
import {
  initialFormState,
  normalizeMemberFormState,
  type MemberFormState,
} from "@/features/members/components/modals/member-manage/types"
import type { Member, MemberEntryAction, MemberManageTab, MemberPatchBody } from "@/features/members/models/member"
import {
  memberEntryToTab,
  memberRoleAsString,
  parseUsdHrPayment,
  splitMemberDisplayName,
  weeklyLimitInputFromStored,
} from "@/features/members/utils/member-utils"
import { MEMBER_COMPACT_MODAL_Z } from "@/features/members/config/members-config"
import { validateMemberFormStateForTabs } from "@/shared/validation/member-form"

const FOCUSED_ACTIONS = new Set<MemberEntryAction>([
  "edit-role",
  "edit-payment",
  "edit-limits",
  "disable-tracking",
  "reset-password",
  "remove-from-tree",
  "remove-member",
])

export type FocusedMemberEntryAction = Exclude<MemberEntryAction, "edit-info">

const ACTION_META: Record<
  FocusedMemberEntryAction,
  { title: string; description: string; submitLabel: string; danger?: boolean }
> = {
  "edit-role": {
    title: "Edit role and memberships",
    description: "Update this member's role. Projects and teams are shown for reference.",
    submitLabel: "Save role",
  },
  "edit-payment": {
    title: "Edit payment details",
    description: "Update pay rate and pay period for this member.",
    submitLabel: "Save payment",
  },
  "edit-limits": {
    title: "Edit limits",
    description: "Set weekly and daily work limits for this member.",
    submitLabel: "Save limits",
  },
  "disable-tracking": {
    title: "Disable tracking",
    description: "Turn off time tracking for this member.",
    submitLabel: "Disable tracking",
  },
  "reset-password": {
    title: "Reset password",
    description: "Send a password reset email so the member can choose a new password.",
    submitLabel: "Send reset email",
  },
  "remove-from-tree": {
    title: "Remove from tree",
    description:
      "Demote this member to Viewer, remove them from the hierarchy, and disconnect them from all teams, projects, and assignments.",
    submitLabel: "Remove from tree",
    danger: true,
  },
  "remove-member": {
    title: "Remove member",
    description: "Permanently remove this member and their profile data. This cannot be undone.",
    submitLabel: "Remove member",
    danger: true,
  },
}

function buildFormFromMember(member: Member, action: MemberEntryAction): MemberFormState {
  const { firstName, lastName } = splitMemberDisplayName(member.name)
  return normalizeMemberFormState({
    ...initialFormState,
    editFirst: firstName,
    editLast: lastName,
    editEmail: member.email,
    editPersonalEmail: member.personalEmail ?? "",
    editPhone: member.phone ?? "",
    role: memberRoleAsString(member.role) as MemberFormState["role"],
    payRate: parseUsdHrPayment(member.payment),
    weeklyLimit: weeklyLimitInputFromStored(member.weeklyLimit || member.limits),
    ableToTrack: action === "disable-tracking" ? false : member.trackingStatus !== "offline",
    lastIp: member.lastIp ?? "",
    manageEmployeeTeams: member.privileges?.manage_employee_teams === true,
  })
}

function buildPayloadForAction(action: MemberEntryAction, formState: MemberFormState): MemberProfilePayload {
  if (action === "edit-role") {
    return { roles: { role: formState.role } }
  }
  if (action === "edit-payment") {
    return {
      payBill: {
        paySegment: formState.paySegment,
        payRate: formState.payRate,
        currency: formState.currency,
        payPeriod: formState.payPeriod,
        note: formState.payNote,
        effectiveDate: formState.payEffectiveDate,
      },
    }
  }
  if (action === "edit-limits") {
    return {
      workLimits: {
        weeklyLimit: formState.weeklyLimit,
        dailyLimit: formState.dailyLimit,
        workDays: formState.workDays,
        makeupDays: formState.makeupDays,
        ...(formState.useShiftsForLimits ? { useShiftsForLimits: true } : {}),
      },
    }
  }
  if (action === "disable-tracking") {
    return { settings: { ableToTrack: false } }
  }
  return {}
}

export function isFocusedMemberEntryAction(action: MemberEntryAction): action is FocusedMemberEntryAction {
  return FOCUSED_ACTIONS.has(action)
}

export function MemberEntryModal({
  open,
  action,
  member,
  isDark = false,
  actorRole = "",
  onClose,
  onPatchMember,
  onSaveProfile,
  onRemoveMember,
  onRemoveFromTree,
  onNavigate,
}: {
  open: boolean
  action: MemberEntryAction | null
  member: Member
  isDark?: boolean
  actorRole?: string
  onClose: () => void
  onPatchMember: (id: string, body: MemberPatchBody) => Promise<Member | undefined>
  onSaveProfile?: (id: string, payload: MemberProfilePayload, expectedUpdatedAt?: string) => Promise<Member>
  onRemoveMember: (id: string) => void | Promise<void>
  onRemoveFromTree?: (id: string) => void | Promise<void>
  onNavigate?: (id: string) => void
}) {
  const { user } = useAuth()
  const assignableRoles = useMemo(() => listAssignableRoles(actorRole), [actorRole])
  const actorRoleContext = useMemo(() => ({ assignableRoles }), [assignableRoles])
  // Server enforces this (member-profile.service.js's hasPayBill branch) -
  // this only decides whether the payBill tab reads as editable here.
  const canEditPayRate = useMemo(() => canEditPayRates(actorRole), [actorRole])

  const [formState, setFormState] = useState<MemberFormState>(initialFormState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  const displayRole = member.role === "User" ? "Viewer" : member.role
  const ownerBlocked = isOwnerRoleName(displayRole)

  useEffect(() => {
    if (!open || !action || !isFocusedMemberEntryAction(action)) return
    setFormState(buildFormFromMember(member, action))
    setError(null)
    setResetMessage(null)
    setBusy(false)
    if (action !== "edit-payment") return
    // This modal builds its form from the already-loaded member row alone
    // (buildFormFromMember), which carries no pay note/effective date/history
    // - only the full Manage-options modal did a per-tab profile fetch. This
    // quick modal is the OTHER of the two payment-editing entry points, so it
    // needs the same real payBill section, not just the bare pay rate.
    let cancelled = false
    void getMemberProfile(member.id, ["payBill"])
      .then(({ form }) => {
        if (cancelled) return
        setFormState((prev) =>
          normalizeMemberFormState({
            ...prev,
            payRate: form.payRate ?? prev.payRate,
            currency: form.currency ?? prev.currency,
            payPeriod: form.payPeriod ?? prev.payPeriod,
            payNote: form.payNote ?? prev.payNote,
            payEffectiveDate: form.payEffectiveDate ?? prev.payEffectiveDate,
            payRateHistory: form.payRateHistory ?? prev.payRateHistory,
          }),
        )
      })
      .catch(() => {
        // Quick modal already has a usable fallback (buildFormFromMember's
        // bare pay rate, PayBillTab's own synthesized "Current" row) - a
        // failed background fetch here degrades to that, not an error state.
      })
    return () => {
      cancelled = true
    }
  }, [open, action, member])

  if (!open || !action || !isFocusedMemberEntryAction(action)) return null

  const focusedAction: FocusedMemberEntryAction = action
  const meta = ACTION_META[focusedAction]
  const activeTab = memberEntryToTab(focusedAction) as MemberManageTab
  const saveValidationError =
    focusedAction === "edit-role" || focusedAction === "edit-payment" || focusedAction === "edit-limits"
      ? validateMemberFormStateForTabs([activeTab], formState, { memberRole: memberRoleAsString(member.role) })
      : null

  const tabProps = {
    member,
    state: formState,
    setState: setFormState,
    actorRole: actorRoleContext,
    onNavigate,
    onClose,
  }

  async function handleSaveProfilePayload(payload: MemberProfilePayload) {
    if (onSaveProfile) {
      await onSaveProfile(member.id, payload)
      return
    }
    await onPatchMember(member.id, {
      role: payload.roles?.role,
      payRate: payload.payBill?.payRate ? Number(payload.payBill.payRate) : undefined,
      weeklyLimit: payload.workLimits?.weeklyLimit?.trim() ? payload.workLimits.weeklyLimit : undefined,
      trackingStatus: payload.settings?.ableToTrack === false ? "offline" : undefined,
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (focusedAction === "remove-from-tree") {
      if (ownerBlocked) {
        setError("The Owner account cannot be removed from the tree.")
        return
      }
      if (!onRemoveFromTree) {
        setError("Remove from tree is not available.")
        return
      }
      setBusy(true)
      try {
        await Promise.resolve(onRemoveFromTree(member.id))
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove from tree failed.")
      } finally {
        setBusy(false)
      }
      return
    }

    if (focusedAction === "remove-member") {
      if (ownerBlocked) {
        setError("The Owner account cannot be removed.")
        return
      }
      setBusy(true)
      try {
        await Promise.resolve(onRemoveMember(member.id))
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove failed.")
      } finally {
        setBusy(false)
      }
      return
    }

    if (focusedAction === "reset-password") {
      const email = (member.email || user?.email || "").trim()
      if (!email) {
        setError("No email address is available for this member.")
        return
      }
      setBusy(true)
      try {
        await sendFirebasePasswordResetEmail(email)
        setResetMessage("If an account exists for this email address, a password reset link has been sent.")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send password reset email.")
      } finally {
        setBusy(false)
      }
      return
    }

    if (saveValidationError) {
      setError(saveValidationError)
      return
    }

    const payload = buildPayloadForAction(focusedAction, formState)
    if (Object.keys(payload).length === 0) {
      setError("Nothing to save for this action.")
      return
    }

    setBusy(true)
    try {
      await handleSaveProfilePayload(payload)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setBusy(false)
    }
  }

  const showFormTabs = focusedAction === "edit-role" || focusedAction === "edit-payment" || focusedAction === "edit-limits"
  const modalWidthClass =
    focusedAction === "edit-payment" ? "max-w-4xl" : focusedAction === "edit-limits" ? "max-w-3xl" : "max-w-lg"

  return (
    <div
      className={cn("fixed inset-0 flex items-center justify-center bg-black/40 p-4", MEMBER_COMPACT_MODAL_Z)}
      aria-label={meta.title}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className={cn(
          "flex max-h-[min(90vh,40rem)] w-full flex-col rounded-xl border shadow-xl",
          modalWidthClass,
          isDark ? "border-[#3d4a3d]/40 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-900",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn("shrink-0 border-b px-6 py-5", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{meta.title}</h2>
              <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{meta.description}</p>
              <p className={cn("mt-2 text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{member.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={cn("rounded-lg p-1", isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-100")}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {ownerBlocked && (focusedAction === "remove-member" || focusedAction === "remove-from-tree") && (
            <div
              className={cn(
                "mb-4 flex gap-2 rounded-lg border px-3 py-2 text-sm",
                isDark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {focusedAction === "remove-from-tree"
                  ? "The Owner account cannot be removed from the tree."
                  : "The Owner account cannot be removed."}
              </span>
            </div>
          )}

          {focusedAction === "disable-tracking" && (
            <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
              Time tracking will be turned off for <strong>{member.name}</strong>. They will no longer be able to track time until tracking is re-enabled.
            </p>
          )}

          {focusedAction === "reset-password" && (
            <div className="space-y-3">
              <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                A reset link will be sent to <strong>{member.email || user?.email || "—"}</strong>.
              </p>
              {resetMessage ? <p className="text-sm text-emerald-600">{resetMessage}</p> : null}
            </div>
          )}

          {focusedAction === "remove-from-tree" && !ownerBlocked && (
            <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
              <strong>{member.name}</strong> will become an independent Viewer with no hierarchy, teams, or project assignments.
            </p>
          )}

          {focusedAction === "remove-member" && !ownerBlocked && (
            <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
              You are about to remove <strong>{member.name}</strong> from the organization.
            </p>
          )}

          {showFormTabs && (
            <div className={cn(isDark && "[&_label]:text-[#bccbb9] [&_h3]:text-[#dce1fb] [&_input]:border-[#3d4a3d]/40 [&_input]:bg-[#191f31] [&_input]:text-[#dce1fb] [&_section]:border-[#3d4a3d]/40")}>
              {focusedAction === "edit-role" && <RolesTab {...tabProps} />}
              {focusedAction === "edit-payment" && <PayBillTab {...tabProps} canEditPayRate={canEditPayRate} />}
              {focusedAction === "edit-limits" && <WorkLimitsTab {...tabProps} />}
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>

        <div
          className={cn(
            "flex shrink-0 justify-end gap-2 border-t px-6 py-4",
            isDark ? "border-[#3d4a3d]/40" : "border-slate-100",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {focusedAction === "reset-password" && resetMessage ? "Close" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              ((focusedAction === "remove-member" || focusedAction === "remove-from-tree") && ownerBlocked) ||
              (focusedAction === "edit-payment" && !canEditPayRate)
            }
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
              meta.danger ? "bg-red-600 hover:bg-red-700" : isDark ? "bg-[#4be277] text-[#0c1324] hover:bg-[#3dd068]" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {focusedAction === "reset-password" && !resetMessage ? <Info className="h-4 w-4" /> : null}
            {busy ? "Working…" : focusedAction === "reset-password" && resetMessage ? "Send again" : meta.submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
