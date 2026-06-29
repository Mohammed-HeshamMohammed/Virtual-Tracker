"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  analyzePassword,
  usePasswordBackendCheck,
  usePasswordPolicy,
} from "@/features/auth/services/password-policy"
import type { AuthStyles } from "@/features/auth/components/style-utils"

type PasswordRegistrationFieldsProps = {
  password: string
  confirmPassword: string
  onPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
  isDark: boolean
  styles: AuthStyles
  onPasswordFocus?: () => void
  onPasswordBlur?: () => void
  passwordPlaceholder?: string
  variant?: "auth" | "plain"
  compact?: boolean
}

export function PasswordRegistrationFields({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  isDark,
  styles,
  onPasswordFocus,
  onPasswordBlur,
  passwordPlaceholder,
  variant = "auth",
  compact = false,
}: PasswordRegistrationFieldsProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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
  const { policy: policyResponse } = usePasswordPolicy()
  const rules = policyResponse.passwordPolicy
  const resolvedPlaceholder =
    passwordPlaceholder ?? `Password (min. ${rules.minLength} characters)`

  const inputClass =
    variant === "auth"
      ? cn(compact ? "h-11" : "h-12", "w-full px-4 text-sm", styles.input)
      : cn(
          "w-full rounded-lg border px-3 py-2 text-sm caret-current",
          isDark
            ? "border-slate-600 bg-[#191f31] text-slate-100 placeholder:text-slate-500"
            : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400",
        )

  const eyeBtnClass =
    variant === "auth" ? styles.eyeBtn : isDark ? "text-slate-400" : "text-slate-500"

  function renderVisibilityToggle(show: boolean, onToggle: () => void, label: string) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold", eyeBtnClass)}
        aria-label={show ? `Hide ${label}` : `Show ${label}`}
      >
        {show ? (
          <span className="inline-flex items-center gap-1">
            <EyeOff className="h-3.5 w-3.5" />
            Hide
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            Show
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          onFocus={onPasswordFocus}
          onBlur={onPasswordBlur}
          onPaste={handlePasteRateLimit}
          className={cn(inputClass, "pr-16")}
          placeholder={resolvedPlaceholder}
          autoComplete="new-password"
          required
          aria-label="Password"
        />
        {renderVisibilityToggle(showPassword, () => setShowPassword((v) => !v), "password")}
      </div>

      <div className="relative">
        <input
          type={showConfirmPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          onPaste={handlePasteRateLimit}
          className={cn(inputClass, "pr-16")}
          placeholder="Confirm password"
          autoComplete="new-password"
          required
          aria-label="Confirm password"
        />
        {renderVisibilityToggle(
          showConfirmPassword,
          () => setShowConfirmPassword((v) => !v),
          "confirm password",
        )}
      </div>
    </div>
  )
}

export function usePasswordRegistrationValidity(password: string, confirmPassword: string): boolean {
  const { policy: policyResponse } = usePasswordPolicy()
  const rules = policyResponse.passwordPolicy
  const backendCheck = usePasswordBackendCheck(password, rules)
  return analyzePassword(password, rules, {
    confirmPassword,
    backendSecurityValid: backendCheck.valid,
    backendSecurityError: backendCheck.error,
    backendRequirements: backendCheck.requirements,
  }).valid
}
