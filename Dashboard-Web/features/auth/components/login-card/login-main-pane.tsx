"use client"

import React, { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { AuthCheckbox } from "@/features/auth/components/auth-checkbox"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import {
  AuthCrossfade,
  AuthMotionPane,
  AuthPresenceFade,
  AuthStaggerGroup,
  AuthStaggerItem,
} from "@/features/auth/components/auth-motion"
import { PasswordRegistrationFields, usePasswordRegistrationValidity } from "@/features/auth/components/password-registration-fields"
import { isValidEmail } from "@/shared/validation"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import type { RegisterEmailAvailability } from "@/features/auth/services/use-register-email-availability"

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function SocialButton({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 items-center justify-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-all duration-200",
        className
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

interface LoginMainPaneProps {
  isDark: boolean
  isActive: boolean
  identifier: string
  setIdentifier: (val: string) => void
  passcode: string
  setPasscode: (val: string) => void
  confirmPasscode: string
  setConfirmPasscode: (val: string) => void
  rememberMe: boolean
  setRememberMe: (val: boolean) => void
  isRegisterMode: boolean
  setIsRegisterMode: React.Dispatch<React.SetStateAction<boolean>>
  registerFirstName: string
  setRegisterFirstName: (val: string) => void
  registerLastName: string
  setRegisterLastName: (val: string) => void
  registerPhone: string
  setRegisterPhone: (val: string) => void
  onSelectTrouble: () => void
  onSelectWorkEmail: () => void
  onRequestAccess: () => void
  onSubmit: (e: React.FormEvent) => void
  actionBusy: boolean
  onGoogleSignIn: () => void
  onAppleSignIn: () => void
  clearAuthError: () => void
  registerEmailAvailability: RegisterEmailAvailability
  showPasswordPanel: boolean
  onPasswordPanelChange: (visible: boolean) => void
}

export function LoginMainPane({
  isDark,
  isActive,
  identifier,
  setIdentifier,
  passcode,
  setPasscode,
  confirmPasscode,
  setConfirmPasscode,
  rememberMe,
  setRememberMe,
  isRegisterMode,
  setIsRegisterMode,
  registerFirstName,
  setRegisterFirstName,
  registerLastName,
  setRegisterLastName,
  registerPhone,
  setRegisterPhone,
  onSelectTrouble,
  onSelectWorkEmail,
  onRequestAccess,
  onSubmit,
  actionBusy,
  onGoogleSignIn,
  onAppleSignIn,
  clearAuthError,
  registerEmailAvailability,
  showPasswordPanel,
  onPasswordPanelChange,
}: LoginMainPaneProps) {
  const u = getAuthStyles(isDark)
  const [showPasscode, setShowPasscode] = useState(false)
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

  const registerPasswordValid = usePasswordRegistrationValidity(
    isRegisterMode ? passcode : "",
    isRegisterMode ? confirmPasscode : "",
  )
  const registerEmailReady =
    !isRegisterMode ||
    (isValidEmail(identifier.trim()) && registerEmailAvailability === "available")
  const canSubmitRegister = !isRegisterMode || (registerPasswordValid && registerEmailReady)
  const fieldHeight = isRegisterMode ? "h-11" : "h-12"
  const modeKey = isRegisterMode ? "register" : "login"

  return (
    <AuthMotionPane isActive={isActive}>
      <AuthCrossfade
        itemKey={modeKey}
        className={cn(
          "shrink-0 text-center font-black leading-tight tracking-tight",
          isRegisterMode ? "pb-4 text-2xl" : "pb-5 text-3xl sm:text-[2rem]",
          u.heading,
        )}
      >
        {isRegisterMode ? "Create account" : "Agent Login"}
      </AuthCrossfade>

      <form onSubmit={onSubmit}>
        <AuthStaggerGroup groupKey={modeKey} className={isRegisterMode ? "space-y-2" : "space-y-3"}>
          <AuthStaggerItem>
            <div className="relative">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={identifier}
                onChange={(e) => {
                  clearAuthError()
                  setIdentifier(e.target.value)
                }}
                className={cn(fieldHeight, "w-full px-4 text-sm", u.input)}
                placeholder="Email address"
                required
                aria-label="Email address"
                aria-invalid={registerEmailAvailability === "taken" ? true : undefined}
              />
              {isRegisterMode && registerEmailAvailability === "available" ? (
                <span className="sr-only" role="status">
                  Email is available
                </span>
              ) : null}
              {isRegisterMode && registerEmailAvailability === "taken" ? (
                <span className="sr-only" role="status">
                  Email is already registered
                </span>
              ) : null}
            </div>
          </AuthStaggerItem>

          <AuthPresenceFade show={isRegisterMode}>
            <AuthStaggerItem>
              <div className="grid grid-cols-2 gap-2">
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  value={registerFirstName}
                  onChange={(e) => {
                    clearAuthError()
                    setRegisterFirstName(sanitizePersonNameInput(e.target.value))
                  }}
                  className={cn(fieldHeight, "w-full px-4 text-sm", u.input)}
                  placeholder="First name"
                  aria-label="First name"
                  required
                />
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  value={registerLastName}
                  onChange={(e) => {
                    clearAuthError()
                    setRegisterLastName(sanitizePersonNameInput(e.target.value))
                  }}
                  className={cn(fieldHeight, "w-full px-4 text-sm", u.input)}
                  placeholder="Last name"
                  aria-label="Last name"
                  required
                />
              </div>
            </AuthStaggerItem>
          </AuthPresenceFade>

          <AuthPresenceFade show={isRegisterMode}>
            <AuthStaggerItem>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={registerPhone}
                onChange={(e) => {
                  clearAuthError()
                  setRegisterPhone(e.target.value)
                }}
                className={cn(fieldHeight, "w-full px-4 text-sm", u.input)}
                placeholder="Phone number (+1… or +20…)"
                aria-label="Phone number"
                required
              />
            </AuthStaggerItem>
          </AuthPresenceFade>

          <AuthStaggerItem>
            <AuthCrossfade itemKey={isRegisterMode ? "register-password" : "login-password"}>
              {isRegisterMode ? (
                <PasswordRegistrationFields
                  password={passcode}
                  confirmPassword={confirmPasscode}
                  onPasswordChange={(value) => {
                    clearAuthError()
                    setPasscode(value)
                    onPasswordPanelChange(value.length > 0)
                  }}
                  onConfirmPasswordChange={(value) => {
                    clearAuthError()
                    setConfirmPasscode(value)
                  }}
                  onPasswordFocus={() => onPasswordPanelChange(true)}
                  onPasswordBlur={() => {
                    if (passcode.length === 0) onPasswordPanelChange(false)
                  }}
                  isDark={isDark}
                  styles={u}
                  compact
                />
              ) : (
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPasscode ? "text" : "password"}
                    value={passcode}
                    onChange={(e) => {
                      clearAuthError()
                      setPasscode(e.target.value)
                    }}
                    onPaste={handlePasteRateLimit}
                    className={cn(fieldHeight, "w-full px-4 pr-16 text-sm", u.input)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                    aria-label="Password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscode((v) => !v)}
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold",
                      u.eyeBtn,
                    )}
                  >
                    {showPasscode ? (
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
                </div>
              )}
            </AuthCrossfade>
          </AuthStaggerItem>

          <AuthStaggerItem>
            <AuthCheckbox
              id="vt-remember-me"
              isDark={isDark}
              checked={rememberMe}
              onChange={setRememberMe}
              label="Remember me on this device"
              className="pt-0.5"
            />
          </AuthStaggerItem>

          <AuthPresenceFade show={!isRegisterMode}>
            <AuthStaggerItem>
              <button
                type="button"
                className={cn("w-full pt-1 text-left text-sm", u.link)}
                onClick={onSelectTrouble}
              >
                Having trouble signing in?
              </button>
            </AuthStaggerItem>
          </AuthPresenceFade>

          <AuthStaggerItem>
            <button
              type="submit"
              disabled={actionBusy || !canSubmitRegister}
              className={cn(
                isRegisterMode ? "mt-1 h-11" : "mt-2 h-12",
                "w-full rounded-xl text-sm",
                u.btnPrimary,
              )}
            >
              {actionBusy
                ? "Please wait…"
                : isRegisterMode
                  ? "Create account"
                  : "Sign in"}
            </button>
          </AuthStaggerItem>

          <AuthStaggerItem>
            <p className={cn("pt-1 text-center text-xs", u.bodySub)}>
              {isRegisterMode ? "Already have an account?" : "New here?"}{" "}
              <button
                type="button"
                className={cn(u.linkBold)}
                onClick={() => {
                  clearAuthError()
                  setIsRegisterMode((v) => {
                    if (v) {
                      setRegisterFirstName("")
                      setRegisterLastName("")
                      setRegisterPhone("")
                      setConfirmPasscode("")
                      onPasswordPanelChange(false)
                    }
                    return !v
                  })
                }}
              >
                {isRegisterMode ? "Sign in" : "Create an account"}
              </button>
            </p>
          </AuthStaggerItem>
        </AuthStaggerGroup>
      </form>

      <AuthStaggerGroup groupKey={`${modeKey}-footer`} className={isRegisterMode ? "mt-3" : "mt-5"}>
        <AuthStaggerItem>
          <div className={cn("flex items-center gap-3 text-sm", u.dividerLabel)}>
            <div className={cn("h-px flex-1", u.dividerBar)} />
            <span className={cn("text-xs font-medium tracking-wide uppercase", u.dividerLabel)}>
              {isRegisterMode ? "Or sign up with" : "Or sign in with"}
            </span>
            <div className={cn("h-px flex-1", u.dividerBar)} />
          </div>
        </AuthStaggerItem>

        <AuthStaggerItem className="mt-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <SocialButton
              icon={<GoogleIcon className="h-4 w-4 shrink-0" />}
              label="Google"
              className={u.social}
              onClick={onGoogleSignIn}
            />
            <SocialButton
              icon={<AppleIcon className={cn("h-4 w-4 shrink-0", isDark ? "text-[#dce1fb]" : "text-[#171c1f]")} />}
              label="Apple ID"
              className={u.social}
              onClick={onAppleSignIn}
            />
          </div>
        </AuthStaggerItem>

        <AuthPresenceFade show={!isRegisterMode} className="mt-5">
          <AuthStaggerItem>
            <button
              type="button"
              className={cn("w-full text-center text-sm", u.link)}
              onClick={onSelectWorkEmail}
            >
              Sign in using work email
            </button>
          </AuthStaggerItem>
          <AuthStaggerItem className="mt-2">
            <p className={cn("text-center text-sm", u.bodySub)}>
              Don&apos;t have an account?{" "}
              <button type="button" className={cn(u.linkBold)} onClick={onRequestAccess}>
                Request Now
              </button>
            </p>
          </AuthStaggerItem>
        </AuthPresenceFade>
      </AuthStaggerGroup>

    </AuthMotionPane>
  )
}
