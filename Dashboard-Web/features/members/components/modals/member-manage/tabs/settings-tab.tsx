"use client"

import { useState } from "react"
import { Info, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { Toggle } from "@/shared/ui/toggle";
import { MODAL_LABEL } from "@/features/members/config/members-config"
import type { Member } from "@/features/members/models/member"
import type { TabProps } from "@/features/members/components/modals/member-manage/types"
import { normalizeMemberRole, isEmployeeL2OrHigherRole } from "@/features/auth"
import { sendFirebasePasswordResetEmail } from "@/features/auth/services/password-reset"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import {
  AccountActionDialog,
  clearLocalSessionAfterAccountDeletion,
} from "@/features/profile/components/account-action-dialog"

interface SettingsTabProps extends TabProps {
  member: Member
  removeConfirm: boolean
  setRemoveConfirm: (v: boolean) => void
  busy: boolean
  onRemove: () => void
  limitedSelfManage?: boolean
}

const DROPDOWN_BASE =
  "flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 w-48"
const DROPDOWN_ITEM =
  "w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg"
const DROPDOWN_MENU = "absolute z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg"

function ComingSoonBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
      Coming soon
    </span>
  )
}

function DisabledSetting({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="pointer-events-none rounded-xl border border-slate-200 bg-slate-50/80 p-4 opacity-60">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <ComingSoonBadge />
      </div>
      {hint ? <p className="mb-3 text-xs text-slate-500">{hint}</p> : null}
      {children}
    </div>
  )
}

function IdleTimeoutDropdown({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const options = [5, 10, 15, 20, "Custom"].map((o) => (typeof o === "number" ? `${o} min` : o))

  return (
    <div>
      <span className={MODAL_LABEL}>Idle timeout</span>
      <div className="relative mt-2">
        <button type="button" onClick={() => setOpen(!open)} className={DROPDOWN_BASE}>
          <span>{value}</span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
        {open && (
          <div className={DROPDOWN_MENU}>
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
                className={DROPDOWN_ITEM}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsTab({
  member,
  state,
  setState,
  removeConfirm,
  setRemoveConfirm,
  busy,
  onRemove,
  limitedSelfManage = false,
}: SettingsTabProps) {
  const { user, memberId, memberRole } = useAuth()
  const { canManageMembers } = usePermissions()
  const [resetMessage, setResetMessage] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [selfActionOpen, setSelfActionOpen] = useState(false)

  const isSelf =
    member.id === memberId ||
    Boolean(member.firebaseUid && user?.uid && member.firebaseUid === user.uid)
  const isViewer = normalizeMemberRole(memberRole) === "viewer"
  const isEmailPasswordUser = user?.providerData?.some((p) => p.providerId === "password") ?? false
  const showAdminRemove = canManageMembers && !isSelf
  const showSelfRemove = isSelf
  const memberRoleLabel = member.role_name || member.role || ""
  const showManageEmployeeTeams = isEmployeeL2OrHigherRole(memberRoleLabel) && !limitedSelfManage

  async function handlePasswordReset() {
    const email = (member.email || user?.email || "").trim()
    if (!email) {
      setResetError("No email address is available for this member.")
      setResetMessage(null)
      return
    }
    setResetBusy(true)
    setResetError(null)
    setResetMessage(null)
    try {
      await sendFirebasePasswordResetEmail(email)
      setResetMessage("If an account exists for this email address, a password reset link has been sent.")
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Could not send password reset email.")
    } finally {
      setResetBusy(false)
    }
  }

  if (limitedSelfManage) {
    return (
      <div className="max-w-md">
        <section id="member-reset-password" className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-800">Password</h3>
          <p className="mb-3 text-xs text-slate-500">
            Send a password reset email so you can choose a new password.
          </p>
          {resetMessage ? <p className="mb-2 text-sm text-emerald-700">{resetMessage}</p> : null}
          {resetError ? <p className="mb-2 text-sm text-red-700">{resetError}</p> : null}
          <button
            type="button"
            disabled={resetBusy || !(member.email || user?.email)}
            onClick={() => void handlePasswordReset()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Info className="h-4 w-4 text-slate-500" />
            {resetBusy ? "Sending…" : "Reset password…"}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <section id="member-time-tracking-settings" className="flex-1 space-y-4">
        <h3 className="text-sm font-bold text-slate-800">Time tracking</h3>

        <DisabledSetting
          label="Able to track time"
          hint="This setting is not yet available."
        >
          <div className="flex items-center gap-3">
            <Toggle checked={state.ableToTrack} onChange={() => {}} disabled />
            <span className="text-sm text-slate-600">Able to track time</span>
          </div>
        </DisabledSetting>

        <DisabledSetting label="Keep idle time" hint="This setting is not yet available.">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {(["Prompt", "Always", "Never"] as const).map((m) => (
              <span
                key={m}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold",
                  state.idleMode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                )}
              >
                {m}
              </span>
            ))}
          </div>
        </DisabledSetting>

        <IdleTimeoutDropdown
          value={state.idleTimeout || "5 min"}
          onChange={(v) => setState((s) => ({ ...s, idleTimeout: v }))}
        />

        <DisabledSetting label="Modify Time (manual time)" hint="This setting is not yet available.">
          <div className="flex flex-wrap items-end gap-6">
            <span className="text-sm text-slate-600">{state.manualTime || "Off"}</span>
            <div className="flex items-center gap-3">
              <Toggle checked={state.requireApproval || false} onChange={() => {}} disabled />
              <span className="text-sm text-slate-600">Require approval</span>
            </div>
          </div>
        </DisabledSetting>

        <DisabledSetting
          label="Profile fields"
          hint="This setting is not yet available."
        >
          <span className="text-sm text-slate-600">Manage profile fields</span>
        </DisabledSetting>

        {showManageEmployeeTeams && canManageMembers ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Manage Employee teams</span>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Allow this member to create teams and assign members at Employee L2 and below.
            </p>
            <div className="flex items-center gap-3">
              <Toggle
                checked={state.manageEmployeeTeams}
                onChange={() => setState((s) => ({ ...s, manageEmployeeTeams: !s.manageEmployeeTeams }))}
              />
              <span className="text-sm text-slate-600">Manage Employee teams</span>
            </div>
          </div>
        ) : null}
      </section>

      <div className="w-full space-y-4 lg:w-80">
        <section id="member-reset-password" className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-800">Password</h3>
          <p className="mb-3 text-xs text-slate-500">
            Send a Firebase password reset email so the member can choose a new password.
          </p>
          {resetMessage ? <p className="mb-2 text-sm text-emerald-700">{resetMessage}</p> : null}
          {resetError ? <p className="mb-2 text-sm text-red-700">{resetError}</p> : null}
          <button
            type="button"
            disabled={resetBusy || !(member.email || user?.email)}
            onClick={() => void handlePasswordReset()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Info className="h-4 w-4 text-slate-500" />
            {resetBusy ? "Sending…" : "Reset password…"}
          </button>
        </section>

        {showAdminRemove ? (
          <section className="rounded-xl border border-red-100 bg-red-50/40 p-4">
            <h3 className="mb-2 text-sm font-bold text-red-900">Remove member</h3>
            <p className="mb-3 text-sm text-red-800/90">
              Permanently remove {member.name} from the organization. This cannot be undone.
            </p>
            {!removeConfirm ? (
              <button
                type="button"
                onClick={() => setRemoveConfirm(true)}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Remove member
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onRemove}
                  className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {busy ? "Removing…" : "Yes, remove permanently"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoveConfirm(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        ) : null}

        {showSelfRemove ? (
          <section className="rounded-xl border border-red-100 bg-red-50/40 p-4">
            <h3 className="mb-2 text-sm font-bold text-red-900">Remove myself</h3>
            <p className="mb-3 text-sm text-red-800/90">
              {isViewer
                ? "Permanently delete your account, profile, and member records."
                : "Request account deactivation. An Admin, Super Admin, or Owner will review your request."}
            </p>
            <button
              type="button"
              onClick={() => setSelfActionOpen(true)}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Remove myself
            </button>
          </section>
        ) : null}
      </div>

      <AccountActionDialog
        open={selfActionOpen}
        onOpenChange={setSelfActionOpen}
        mode={isViewer ? "delete" : "request"}
        user={user}
        isEmailPasswordUser={isEmailPasswordUser}
        isDark={false}
        onDeleted={() => void clearLocalSessionAfterAccountDeletion()}
      />
    </div>
  )
}
