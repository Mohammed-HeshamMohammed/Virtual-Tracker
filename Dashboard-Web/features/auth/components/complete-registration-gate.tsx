"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"
import { useAuth } from "@/shared/providers/app"
import { completeFirstLoginWithBackend } from "@/features/auth/services/complete-first-login"
import { validatePasswordWithBackend } from "@/features/auth/api/validate-password-api"
import { cn } from "@/shared/utils/utils"
import { validatePassword } from "@/shared/validation"
import { usePasswordPolicy } from "@/features/auth/services/password-policy"
import { useTheme } from "@/shared/providers/app"
import {
  PasswordRegistrationFields,
  usePasswordRegistrationValidity,
} from "@/features/auth/components/password-registration-fields"
import { PasswordStrengthPanel } from "@/features/auth/components/password-strength-panel"
import { AuthPasswordTipPanel } from "@/features/auth/components/auth-password-tip-panel"
import { AuthMobileHelperStrip, AuthSidePanel } from "@/features/auth/components/auth-side-panels"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { DASHBOARD_PATH } from "@/features/auth/services/navigation"

export function CompleteRegistrationGate() {
  const { user } = useAuth()
  const { isDark } = useTheme()
  const styles = getAuthStyles(isDark)
  const [currentPassword, setCurrentPassword] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showStrengthPanel, setShowStrengthPanel] = useState(false)
  const [pasteCount, setPasteCount] = useState(0)
  const [lastPasteTime, setLastPasteTime] = useState(0)

  function handlePasteRateLimit(e: React.ClipboardEvent) {
    const now = Date.now()
    if (now - lastPasteTime > 30000) {
      setPasteCount(1)
      setLastPasteTime(now)
    } else {
      if (pasteCount >= 5) {
        e.preventDefault()
        alert("Security limit: Too many paste attempts. Please type manually or wait.")
        return
      }
      setPasteCount((c) => c + 1)
    }
  }

  const { policy: passwordPolicy } = usePasswordPolicy()
  const newPasswordValid = usePasswordRegistrationValidity(password, confirm)
  const canSubmit = currentPassword.trim().length > 0 && newPasswordValid

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!user) return
    if (!currentPassword.trim()) {
      setError("Current password is required.")
      return
    }
    const passwordError = validatePassword(password, {
      confirmPassword: confirm,
      requireConfirm: true,
      policy: passwordPolicy.passwordPolicy,
    })
    if (passwordError) {
      setError(passwordError)
      return
    }

    const backendValidation = await validatePasswordWithBackend(password, confirm)
    if (!backendValidation.valid) {
      setError(backendValidation.error ?? "Password does not meet security requirements.")
      return
    }

    setBusy(true)
    try {
      const result = await completeFirstLoginWithBackend({
        currentPassword,
        newPassword: password,
        confirmPassword: confirm,
      })
      if (result.requireSignIn) {
        const auth = getFirebaseAuth()
        await auth.signOut()
        const url = new URL(DASHBOARD_PATH, window.location.origin)
        url.searchParams.set("passwordUpdated", "1")
        window.location.replace(url.toString())
        return
      }
      setError("Password was updated but sign-in is required. Please sign out and sign in again.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.")
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return null
  }

  const currentInputClass = cn(
    "w-full rounded-lg border px-3 py-2 text-sm pr-16",
    isDark
      ? "border-slate-600 bg-[#191f31] text-slate-100 placeholder:text-slate-500"
      : "border-slate-200",
  )

  const passwordStrengthPanel = (
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
        onClick={(e) => e.stopPropagation()}
        className={cn("w-full space-y-4 rounded-2xl border p-8 shadow-2xl", styles.card)}
      >
      <h1 id="vt-must-password-title" className={cn("text-xl font-bold", styles.heading)}>
        Change your password
      </h1>
      <p className={cn("text-sm", styles.body)}>
        Your account was created by an administrator. Enter the temporary password you received by email, then choose a
        new password. You cannot access the application until this step is complete.
      </p>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="vt-current-password"
            className={cn(
              "mb-1 block text-xs font-semibold uppercase tracking-wide",
              isDark ? "text-slate-500" : "text-slate-500",
            )}
          >
            Current password
          </label>
          <div className="relative">
            <input
              id="vt-current-password"
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              onPaste={handlePasteRateLimit}
              className={currentInputClass}
              placeholder="Temporary password"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold",
                isDark ? "text-slate-400" : "text-slate-500",
              )}
              aria-label={showCurrent ? "Hide current password" : "Show current password"}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <label
          className={cn(
            "mb-1 block text-xs font-semibold uppercase tracking-wide",
            isDark ? "text-slate-500" : "text-slate-500",
          )}
        >
          New password
        </label>
        <PasswordRegistrationFields
          password={password}
          confirmPassword={confirm}
          onPasswordChange={(value) => {
            setPassword(value)
            setShowStrengthPanel(value.length > 0)
          }}
          onConfirmPasswordChange={setConfirm}
          onPasswordFocus={() => setShowStrengthPanel(true)}
          onPasswordBlur={() => {
            if (password.length === 0) setShowStrengthPanel(false)
          }}
          isDark={isDark}
          styles={styles}
          variant="plain"
          passwordPlaceholder="New password"
        />
      </div>
      {error ? <p className={cn("text-sm", isDark ? "text-red-400" : "text-red-600")}>{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !canSubmit}
        className={cn("w-full rounded-xl py-2.5 text-sm", styles.btnPrimary)}
      >
        {busy ? "Updating…" : "Update password and sign out"}
      </button>
      </form>

      <AuthMobileHelperStrip visible={showStrengthPanel}>
        <AuthPasswordTipPanel isDark={isDark} styles={styles} />
      </AuthMobileHelperStrip>
      <AuthMobileHelperStrip visible={showStrengthPanel}>
        <div className={sidePanelCardClass}>{passwordStrengthPanel}</div>
      </AuthMobileHelperStrip>

      <AuthSidePanel side="left" visible={showStrengthPanel}>
        <AuthPasswordTipPanel isDark={isDark} styles={styles} />
      </AuthSidePanel>

      <AuthSidePanel side="right" visible={showStrengthPanel}>
        <div className={sidePanelCardClass}>{passwordStrengthPanel}</div>
      </AuthSidePanel>
    </div>
  )
}
