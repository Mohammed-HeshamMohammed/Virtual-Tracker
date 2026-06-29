"use client"

import React from "react"
import { cn } from "@/shared/utils/utils"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import {
  AuthMotionPane,
  AuthPaneContent,
  AuthPresenceFade,
  AuthStaggerGroup,
  AuthStaggerItem,
} from "@/features/auth/components/auth-motion"
import { PASSWORD_RESET_SUCCESS_MESSAGE } from "@/features/auth/services/password-reset"

interface LoginRecoveryPaneProps {
  isDark: boolean
  isActive: boolean
  pane: "forgot-email" | "forgot-password" | "forgot-work-mail"
  recoveryPhone: string
  setRecoveryPhone: (val: string) => void
  recoveryEmail: string
  setRecoveryEmail: (val: string) => void
  onSubmit: (e: React.FormEvent) => void
  recoverSubmitting: boolean
  recoverNotice: boolean
  recoverError: string | null
  onBack: () => void
  clearAuthError: () => void
}

export function LoginRecoveryPane({
  isDark,
  isActive,
  pane,
  recoveryPhone,
  setRecoveryPhone,
  recoveryEmail,
  setRecoveryEmail,
  onSubmit,
  recoverSubmitting,
  recoverNotice,
  recoverError,
  onBack,
  clearAuthError,
}: LoginRecoveryPaneProps) {
  const u = getAuthStyles(isDark)

  return (
    <AuthMotionPane isActive={isActive}>
      <AuthPaneContent paneKey={pane}>
        {pane === "forgot-email" ? (
          <AuthStaggerGroup groupKey="forgot-email">
            <AuthStaggerItem>
              <p className={cn("text-center text-xl font-black tracking-tight", u.heading)}>
                Forgot your email?
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <p className={cn("mt-2 text-sm leading-relaxed", u.bodySub)}>
                Enter the phone number associated with your account.
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <form onSubmit={onSubmit} className="mt-6 space-y-3">
                <input
                  type="tel"
                  value={recoveryPhone}
                  onChange={(e) => setRecoveryPhone(e.target.value)}
                  className={cn("h-12 w-full px-4 text-sm", u.input)}
                  placeholder="Phone number"
                  autoComplete="tel"
                  required
                  aria-label="Phone number"
                />
                <button
                  type="submit"
                  disabled={recoverSubmitting}
                  className={cn("h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                >
                  {recoverSubmitting ? "Please wait…" : "Continue"}
                </button>
                <AuthPresenceFade show={recoverNotice}>
                  <p className={cn("text-center text-xs leading-snug", u.hint)}>
                    If your phone is on file, a workspace admin can help recover your sign-in.
                  </p>
                </AuthPresenceFade>
                <button type="button" className={cn("pt-2 text-center text-sm", u.link)} onClick={onBack}>
                  Back
                </button>
              </form>
            </AuthStaggerItem>
          </AuthStaggerGroup>
        ) : null}

        {pane === "forgot-password" ? (
          <AuthStaggerGroup groupKey="forgot-password">
            <AuthStaggerItem>
              <p className={cn("text-center text-xl font-black tracking-tight", u.heading)}>
                Reset your password
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <p className={cn("mt-2 text-sm leading-relaxed", u.bodySub)}>
                Enter your email address and we will send you a link to reset your password.
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <form onSubmit={onSubmit} className="mt-6 space-y-3" aria-label="Password reset form">
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => {
                    clearAuthError()
                    setRecoveryEmail(e.target.value)
                  }}
                  className={cn("h-12 w-full px-4 text-sm", u.input)}
                  placeholder="Email address"
                  autoComplete="email"
                  required
                  aria-label="Email address"
                  aria-invalid={recoverError ? true : undefined}
                />
                <AuthPresenceFade show={Boolean(recoverError)}>
                  <p className={cn("text-center text-xs leading-snug text-red-500", isDark && "text-red-400")} role="alert">
                    {recoverError}
                  </p>
                </AuthPresenceFade>
                <button
                  type="submit"
                  disabled={recoverSubmitting || recoverNotice}
                  className={cn("h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                >
                  {recoverSubmitting ? "Please wait…" : "Send reset email"}
                </button>
                <AuthPresenceFade show={recoverNotice}>
                  <p className={cn("text-center text-xs leading-snug", u.hint)} role="status">
                    {PASSWORD_RESET_SUCCESS_MESSAGE} Check your spam folder if you do not see it shortly.
                  </p>
                </AuthPresenceFade>
                <button type="button" className={cn("pt-2 text-center text-sm", u.link)} onClick={onBack}>
                  Back
                </button>
              </form>
            </AuthStaggerItem>
          </AuthStaggerGroup>
        ) : null}

        {pane === "forgot-work-mail" ? (
          <AuthStaggerGroup groupKey="forgot-work-mail">
            <AuthStaggerItem>
              <p className={cn("text-center text-xl font-black tracking-tight", u.heading)}>
                Forgot your work email?
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <p className={cn("mt-2 text-sm leading-relaxed", u.bodySub)}>
                Enter the phone number we can use to help recover your work email.
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <form onSubmit={onSubmit} className="mt-6 space-y-3" aria-label="Work email recovery form">
                <input
                  type="tel"
                  value={recoveryPhone}
                  onChange={(e) => setRecoveryPhone(e.target.value)}
                  className={cn("h-12 w-full px-4 text-sm", u.input)}
                  placeholder="Phone number"
                  autoComplete="tel"
                  required
                  aria-label="Phone number"
                />
                <button
                  type="submit"
                  disabled={recoverSubmitting}
                  className={cn("h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                >
                  {recoverSubmitting ? "Please wait…" : "Continue"}
                </button>
                <AuthPresenceFade show={recoverNotice}>
                  <p className={cn("text-center text-xs leading-snug", u.hint)}>
                    Contact your IT admin with the phone you used. Automated work email recovery is not available
                    here.
                  </p>
                </AuthPresenceFade>
                <button type="button" className={cn("pt-2 text-center text-sm", u.link)} onClick={onBack}>
                  Back
                </button>
              </form>
            </AuthStaggerItem>
          </AuthStaggerGroup>
        ) : null}
      </AuthPaneContent>
    </AuthMotionPane>
  )
}
