/* eslint-disable react-doctor/exhaustive-deps */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { patchProfileSettingsWithBackend } from "@/features/auth/api/profile-settings-api"
import { phoneNumbersMatch } from "@/features/auth/services/phone-verification-api"
import { parseUsdHrPayment, splitMemberDisplayName } from "@/features/members/utils/member-utils"
import { validateEmailField, validatePersonName, validatePhoneField } from "@/shared/validation"
import { SidebarSection } from "@/features/profile/components/sidebar-section"
import { AccountForm } from "@/features/profile/components/account-form"
import { ChangePasswordDialog } from "@/features/profile/components/change-password-dialog"
import type { PhoneVerifyControlHandle } from "@/shared/ui/phone-verify-control"

function getInitials(name: string | null): string {
  if (!name) return "U"
  const parts = name.split(" ").filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function resolveSharedPhoneState(
  profile: { phone?: string | null; phoneVerified?: boolean } | null | undefined,
  member: { phone?: string; phoneVerified?: boolean } | null | undefined,
) {
  const phone =
    (typeof profile?.phone === "string" && profile.phone.trim() ? profile.phone : "") ||
    (typeof member?.phone === "string" ? member.phone : "") ||
    ""
  const phoneVerified = member?.phoneVerified === true || profile?.phoneVerified === true
  return { phone, phoneVerified }
}

export function ProfilePage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const { user, profile, currentMember, memberRole, memberId, refreshProfile } = useAuth()

  const displayName = user?.displayName || ""
  const accountEmail = user?.email || profile?.primaryEmail || ""

  const baseline = useMemo(() => {
    const nameParts = displayName.split(" ").filter(Boolean)
    const memberNames = currentMember?.name ? splitMemberDisplayName(currentMember.name) : { firstName: "", lastName: "" }
    const sharedPhone = resolveSharedPhoneState(profile, currentMember)
    return {
      firstName:
        typeof profile?.firstName === "string" && profile.firstName
          ? profile.firstName
          : nameParts[0] || memberNames.firstName || "",
      lastName:
        typeof profile?.lastName === "string" && profile.lastName
          ? profile.lastName
          : nameParts.slice(1).join(" ") || memberNames.lastName || "",
      email: accountEmail,
      phone: sharedPhone.phone,
      phoneVerified: sharedPhone.phoneVerified,
    }
  }, [
    profile?.firstName,
    profile?.lastName,
    profile?.phone,
    profile?.phoneVerified,
    profile?.uid,
    displayName,
    accountEmail,
    currentMember?.name,
    currentMember?.phone,
    currentMember?.phoneVerified,
  ])

  const [firstName, setFirstName] = useComponentState(() => baseline.firstName)
  const [lastName, setLastName] = useComponentState(() => baseline.lastName)
  const [email, setEmail] = useComponentState(() => baseline.email)
  const [phone, setPhone] = useComponentState(() => baseline.phone)
  const [phoneVerificationToken, setPhoneVerificationToken] = useComponentState<string | null>(null)
  const [saveStatus, setSaveStatus] = useComponentState<"idle" | "saved">("idle")
  const [saveBusy, setSaveBusy] = useComponentState(false)
  const [saveMessage, setSaveMessage] = useComponentState<string | null>(null)
  const [changePasswordOpen, setChangePasswordOpen] = useComponentState(false)

  const emailInputRef = useRef<HTMLInputElement>(null)
  const phoneVerifyRef = useRef<PhoneVerifyControlHandle>(null)

  const isEmailPasswordUser = user?.providerData?.some((p) => p.providerId === "password") ?? false
  const payRateDisplay = (() => {
    const payment = currentMember?.payment ?? ""
    if (!payment || payment === "No rate set") return ""
    const parsed = parseUsdHrPayment(payment)
    return parsed || payment.replace(/\/hr$/i, "").replace(/^\$/, "")
  })()

  const phoneChanged = Boolean(phone.trim() && !phoneNumbersMatch(phone, baseline.phone))
  const phoneAlreadyVerified =
    baseline.phoneVerified && phoneNumbersMatch(phone, baseline.phone) && !phoneChanged
  const phoneSavePending = Boolean(phoneVerificationToken?.trim())

  const isDirty = useMemo(
    () =>
      firstName !== baseline.firstName ||
      lastName !== baseline.lastName ||
      email.trim().toLowerCase() !== baseline.email.trim().toLowerCase() ||
      phoneChanged ||
      phoneSavePending,
    [firstName, lastName, email, baseline, phoneChanged, phoneSavePending],
  )

  useEffect(() => {
    setFirstName(baseline.firstName)
    setLastName(baseline.lastName)
    setEmail(baseline.email)
    setPhone(baseline.phone)
    setPhoneVerificationToken(null)
  }, [baseline.firstName, baseline.lastName, baseline.email, baseline.phone, baseline.phoneVerified])

  const resetForm = useCallback(() => {
    setFirstName(baseline.firstName)
    setLastName(baseline.lastName)
    setEmail(baseline.email)
    setPhone(baseline.phone)
    setPhoneVerificationToken(null)
    setSaveStatus("idle")
    setSaveMessage(null)
  }, [baseline])

  function handlePhoneChange(value: string) {
    setPhone(value)
    setPhoneVerificationToken(null)
  }

  function handlePhoneVerificationChange(token: string | null) {
    setPhoneVerificationToken(token)
  }

  async function handleSave() {
    if (!user || !isDirty) return
    const phoneValidation = phone.trim() ? validatePhoneField(phone, { label: "Phone number" }) : null

    const validationError = validatePersonName(firstName, lastName) ?? validateEmailField(email, { label: "Email" }) ?? phoneValidation

    if (validationError) {
      setSaveMessage(validationError)
      return
    }

    let tokenForSave = phoneVerificationToken?.trim() || null
    if (phone.trim() && !phoneAlreadyVerified && phoneVerifyRef.current?.requiresVerification()) {
      try {
        const confirmed = await phoneVerifyRef.current.confirmPendingVerification()
        if (confirmed) {
          tokenForSave = confirmed
          setPhoneVerificationToken(confirmed)
        }
      } catch (err) {
        setSaveMessage(err instanceof Error ? err.message : "Phone verification failed.")
        return
      }
      if (!tokenForSave) {
        setSaveMessage("Send a verification code, enter it, then click Save.")
        return
      }
    }

    setSaveBusy(true)
    setSaveMessage(null)
    try {
      const payload: {
        firstName: string
        lastName: string
        email?: string
        phone?: string
        phoneVerificationToken?: string
      } = {
        firstName,
        lastName,
      }
      const normalizedEmail = email.trim().toLowerCase()
      if (normalizedEmail !== baseline.email.trim().toLowerCase()) {
        payload.email = normalizedEmail
      }
      const phoneDirty = phone.trim() && (phoneChanged || Boolean(tokenForSave) || !phoneAlreadyVerified)
      if (phoneDirty) {
        payload.phone = phone.trim()
        if (tokenForSave) {
          payload.phoneVerificationToken = tokenForSave
        }
      }
      await patchProfileSettingsWithBackend(user, payload)
      await refreshProfile()
      if (memberId) {
        const { invalidateMemberProfileCache } = await import("@/features/members/services/member-profile-cache")
        invalidateMemberProfileCache(memberId)
      }
      setPhoneVerificationToken(null)
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 2000)
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Could not save profile.")
    } finally {
      setSaveBusy(false)
    }
  }

  function focusEmailField() {
    emailInputRef.current?.focus()
    emailInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const title = isDark ? "text-[#dce1fb]" : "text-slate-800"

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", isDark ? "bg-[#101417]" : "bg-slate-50/40")}>
      <div
        className="mx-auto flex w-full min-h-0 max-w-[1200px] flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:gap-7 sm:px-6 sm:py-6 lg:flex-row"
        style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
      >
        <SidebarSection
          user={user}
          profile={profile}
          displayName={displayName}
          memberRole={memberRole}
          isDark={isDark}
          refreshProfile={refreshProfile}
          isEmailPasswordUser={isEmailPasswordUser}
          getInitials={getInitials}
          onFocusEmail={focusEmailField}
          onChangePassword={() => setChangePasswordOpen(true)}
        />

        <div className="min-w-0 flex-1 flex flex-col justify-start">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", title)}>Edit account</h1>
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end sm:gap-2 md:flex-row md:items-center">
              {saveMessage && (
                <p className={cn("max-w-xs text-left text-xs sm:text-right", isDark ? "text-amber-200/90" : "text-amber-700")}>
                  {saveMessage}
                </p>
              )}
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <button
                  type="button"
                  disabled={saveBusy || !isDirty}
                  onClick={resetForm}
                  className={cn(
                    "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    isDark ? "border-white/10 text-[#dce1fb] hover:bg-white/5" : "border-slate-200 text-slate-700 hover:bg-slate-50",
                    (saveBusy || !isDirty) && "pointer-events-none opacity-50",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saveBusy || !user || !isDirty}
                  onClick={() => void handleSave()}
                  className="flex-1 rounded-lg bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:pointer-events-none disabled:opacity-50 sm:flex-none"
                >
                  {saveBusy ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save"}
                </button>
              </div>
            </div>
          </div>

          <AccountForm
            emailInputRef={emailInputRef}
            phoneVerifyRef={phoneVerifyRef}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            email={email}
            setEmail={setEmail}
            phone={phone}
            onPhoneChange={handlePhoneChange}
            phoneVerificationToken={phoneVerificationToken}
            onPhoneVerificationChange={handlePhoneVerificationChange}
            phoneInitiallyVerified={phoneAlreadyVerified}
            payRateDisplay={payRateDisplay}
            isDark={isDark}
          />

          <div className="mt-4 flex justify-end sm:hidden">
            <button
              type="button"
              onClick={() => onNavigate("command-center")}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium",
                isDark ? "border-white/10 text-[#dce1fb]" : "border-slate-200 text-slate-700",
              )}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        user={user}
        isDark={isDark}
      />
    </div>
  )
}
