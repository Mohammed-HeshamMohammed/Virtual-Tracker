"use client"

import { cn } from "@/shared/utils/utils"
import { Toggle } from "@/shared/ui/forms/toggle"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import type { AccountFormFields } from "@/features/members/models/member"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import { isValidEmail } from "@/shared/validation"
import {
  CrossfadePanel,
  SegmentedControl,
} from "@/features/clients/components/modals/client-modal/animated-primitives"

export type ClientMemberInviteMode = "invites" | "accounts"

export type ClientMemberDraft = {
  mode: ClientMemberInviteMode
  inviteEmail: string
  accountForm: AccountFormFields
  sendWelcomeEmail: boolean
}

export const emptyClientMemberDraft = (): ClientMemberDraft => ({
  mode: "invites",
  inviteEmail: "",
  accountForm: { firstName: "", lastName: "", email: "", payRate: "", currency: "USD" },
  sendWelcomeEmail: true,
})

type ClientMemberInvitePanelProps = {
  draft: ClientMemberDraft
  onChange: (draft: ClientMemberDraft) => void
}

const MODE_TABS = [
  { id: "invites" as const, label: "Send invite" },
  { id: "accounts" as const, label: "Create account" },
]

export function ClientMemberInvitePanel({ draft, onChange }: ClientMemberInvitePanelProps) {
  const theme = useClientFormTheme()
  const inputCls = theme.control

  function setMode(mode: ClientMemberInviteMode) {
    onChange({ ...draft, mode })
  }

  function updateAccountField(field: keyof AccountFormFields, value: string) {
    const nextVal = field === "firstName" || field === "lastName" ? sanitizePersonNameInput(value) : value
    onChange({ ...draft, accountForm: { ...draft.accountForm, [field]: nextVal } })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("rounded-xl border p-4", theme.card)}>
        <p className={cn("text-sm font-medium", theme.bodyText)}>Client role member</p>
        <p className={cn("mt-1 text-xs", theme.hint)}>
          New members added here are assigned the Client role and linked to this client record.
        </p>
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold",
            theme.isDark ? "border-[#3d4a3d]/40" : "border-slate-200",
          )}
        >
          <span className={theme.hint}>Role</span>
          <span className={cn("rounded-md px-2 py-0.5", theme.accent.selectedBg, theme.accent.check)}>Client</span>
        </div>
      </div>

      <SegmentedControl
        value={draft.mode}
        options={MODE_TABS}
        onChange={setMode}
        trackClassName={theme.isDark ? "bg-[#191f31]" : "bg-slate-100"}
        pillClassName={theme.isDark ? "bg-[#151b2d]" : "bg-white"}
        buttonClassName={(active) =>
          active
            ? theme.isDark
              ? "text-[#dce1fb]"
              : "text-slate-800"
            : theme.isDark
              ? "text-[#bccbb9] hover:text-[#dce1fb]"
              : "text-slate-500 hover:text-slate-700"
        }
      />

      <CrossfadePanel panelKey={draft.mode} variant="fade">
        {draft.mode === "invites" ? (
          <div className="space-y-4">
            <div>
              <label className={cn("mb-1.5 block", theme.label)}>Email*</label>
              <input
                type="email"
                value={draft.inviteEmail}
                onChange={(e) => onChange({ ...draft, inviteEmail: e.target.value })}
                placeholder="client@company.com"
                className={inputCls}
                aria-label="Client member email"
              />
              <p className={cn("mt-1.5 text-xs", theme.hint)}>
                We&apos;ll send an invite email so they can join with the Client role.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={cn("space-y-3 rounded-xl border p-3", theme.card)}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={cn("mb-1.5 block", theme.label)}>First name*</label>
                  <input
                    type="text"
                    value={draft.accountForm.firstName}
                    onChange={(e) => updateAccountField("firstName", e.target.value)}
                    placeholder="Jane"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={cn("mb-1.5 block", theme.label)}>Last name*</label>
                  <input
                    type="text"
                    value={draft.accountForm.lastName}
                    onChange={(e) => updateAccountField("lastName", e.target.value)}
                    placeholder="Doe"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={cn("mb-1.5 block", theme.label)}>Work email*</label>
                <input
                  type="email"
                  value={draft.accountForm.email}
                  onChange={(e) => updateAccountField("email", e.target.value)}
                  placeholder="jane.doe@company.com"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={draft.sendWelcomeEmail}
                onChange={() => onChange({ ...draft, sendWelcomeEmail: !draft.sendWelcomeEmail })}
              />
              <span className={theme.mutedText}>Send welcome email with sign-in instructions</span>
            </div>
          </div>
        )}
      </CrossfadePanel>
    </div>
  )
}

export function clientMemberDraftDisplayName(draft: ClientMemberDraft): string {
  if (draft.mode === "accounts") {
    return [draft.accountForm.firstName, draft.accountForm.lastName].filter(Boolean).join(" ").trim()
  }
  const email = draft.inviteEmail.trim()
  if (!email) return ""
  return email.split("@")[0]?.trim() || email
}

export function clientMemberDraftEmail(draft: ClientMemberDraft): string {
  return draft.mode === "accounts" ? draft.accountForm.email.trim() : draft.inviteEmail.trim()
}

export function isClientMemberDraftComplete(draft: ClientMemberDraft): boolean {
  const email = clientMemberDraftEmail(draft)
  if (!email || !isValidEmail(email)) return false
  if (draft.mode === "accounts") {
    return Boolean(draft.accountForm.firstName.trim() && draft.accountForm.lastName.trim())
  }
  return true
}
