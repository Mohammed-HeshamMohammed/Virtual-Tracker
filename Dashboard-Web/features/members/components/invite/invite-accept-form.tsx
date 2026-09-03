"use client"

import { useEffect, useState as useComponentState } from "react"
import { useRouter } from "next/navigation"
import { resolvePublicInvite, registerViaInviteToken } from "@/features/members/api/member-api"
import { validateEmailField, validatePassword, validatePersonName, validatePhoneField } from "@/shared/validation"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import { AuthMobileHelperStrip, AuthSidePanel } from "@/features/auth/components/auth-side-panels"
import { PasswordRegistrationFields, usePasswordRegistrationValidity } from "@/features/auth/components/password-registration-fields"
import { PasswordStrengthPanel } from "@/features/auth/components/password-strength-panel"
import { usePasswordPolicy } from "@/features/auth"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"

export function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter()
  const { isDark } = useTheme()
  const styles = getAuthStyles(isDark)
  const [loading, setLoading] = useComponentState(true)
  const [pageError, setPageError] = useComponentState<string | null>(null)
  const [submitError, setSubmitError] = useComponentState<string | null>(null)
  const [emailLocked, setEmailLocked] = useComponentState(false)
  const [email, setEmail] = useComponentState("")
  const [firstName, setFirstName] = useComponentState("")
  const [lastName, setLastName] = useComponentState("")
  const [phone, setPhone] = useComponentState("")
  const [password, setPassword] = useComponentState("")
  const [confirm, setConfirm] = useComponentState("")
  const [busy, setBusy] = useComponentState(false)
  const [showStrengthPanel, setShowStrengthPanel] = useComponentState(false)

  const { policy: passwordPolicy } = usePasswordPolicy()
  const canSubmit = usePasswordRegistrationValidity(password, confirm)

  const fieldClass = cn(
    "w-full rounded-lg border px-3 py-2 text-sm caret-current focus:outline-none focus:ring-1",
    isDark
      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb] placeholder:text-[#bccbb9]/50 focus:border-[#4be277]/40 focus:ring-[#4be277]/20"
      : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:ring-blue-400",
  )

  const labelClass = cn(
    "mb-1 block text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-[#bccbb9]" : "text-slate-500",
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const inv = await resolvePublicInvite(token)
        if (cancelled) return
        setEmailLocked(inv.emailLocked)
        setEmail(inv.emailLocked ? inv.email : inv.email || "")
      } catch (e) {
        if (!cancelled) setPageError(e instanceof Error ? e.message : "Invalid or expired invite.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    const validationError =
      validateEmailField(email, { label: "Email" }) ??
      validatePersonName(firstName, lastName) ??
      validatePhoneField(phone, { required: true, label: "Phone number" }) ??
      validatePassword(password, {
        confirmPassword: confirm,
        requireConfirm: true,
        policy: passwordPolicy.passwordPolicy,
      })
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setBusy(true)
    try {
      await registerViaInviteToken(token, {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        password,
        confirmPassword: confirm,
      })
      router.replace("/?signedUp=1")
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create account.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className={cn("rounded-xl border p-8 text-center text-sm shadow-sm", styles.card, styles.body)}>
        Loading invite…
      </div>
    )
  }

  if (pageError) {
    return (
      <div
        className={cn(
          "rounded-xl border p-8 text-center text-sm shadow-sm",
          isDark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900",
        )}
      >
        {pageError}
      </div>
    )
  }

  const passwordPanel = (
    <PasswordStrengthPanel
      password={password}
      confirmPassword={confirm}
      visible
      isDark={isDark}
      styles={styles}
      compact
      variant="side"
    />
  )

  const sidePanelCardClass = cn(
    "rounded-xl border p-4 shadow-lg",
    styles.card,
    isDark ? "border-[#3d4a3d]/30" : "border-slate-200/80",
  )

  return (
    <div className="relative w-full max-w-[452px] shrink-0">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className={cn("space-y-4 rounded-2xl border p-8 shadow-2xl", styles.card)}
      >
        <h1 className={cn("text-xl font-bold", styles.heading)}>Join Virtual Tracker</h1>
        <p className={cn("text-sm", styles.body)}>
          Create your sign-in. You will use this email and password to log in. You can verify your phone later from
          Profile or Manage myself.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="invite-first-name">
              First name
            </label>
            <input
              id="invite-first-name"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(sanitizePersonNameInput(e.target.value))}
              className={fieldClass}
              autoComplete="given-name"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="invite-last-name">
              Last name
            </label>
            <input
              id="invite-last-name"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(sanitizePersonNameInput(e.target.value))}
              className={fieldClass}
              autoComplete="family-name"
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="invite-phone">
            Phone number
          </label>
          <input
            id="invite-phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 (555) 123-4567 or +20 1xx xxx xxxx"
            className={fieldClass}
            autoComplete="tel"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={emailLocked}
            className={cn(fieldClass, emailLocked && (isDark ? "opacity-80" : "read-only:bg-slate-50"))}
            aria-label="Email"
          />
        </div>
        <div className="space-y-3">
          <label className={labelClass}>Password</label>
          <PasswordRegistrationFields
            password={password}
            confirmPassword={confirm}
            onPasswordChange={(value) => {
              setPassword(value)
              setShowStrengthPanel(value.length > 0)
            }}
            onConfirmPasswordChange={setConfirm}
            onPasswordFocus={() => setShowStrengthPanel(password.length > 0)}
            onPasswordBlur={() => {
              if (password.length === 0) setShowStrengthPanel(false)
            }}
            isDark={isDark}
            styles={styles}
            variant="plain"
          />
        </div>
        {submitError ? (
          <p className={cn("text-sm", isDark ? "text-red-400" : "text-red-600")}>{submitError}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className={cn("w-full rounded-xl py-2.5 text-sm", styles.btnPrimary)}
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <AuthMobileHelperStrip visible={showStrengthPanel}>
        <div className={sidePanelCardClass}>{passwordPanel}</div>
      </AuthMobileHelperStrip>

      <AuthSidePanel side="right" visible={showStrengthPanel}>
        <div className={sidePanelCardClass}>{passwordPanel}</div>
      </AuthSidePanel>
    </div>
  )
}
