"use client"

import React from "react"
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

const WORK_EMAIL_LOGIN_ENABLED = false

interface LoginWorkEmailPaneProps {
  isDark: boolean
  isActive: boolean
  pane: "work-email" | "work-email-code"
  workEmail: string
  setWorkEmail: (val: string) => void
  rememberMe: boolean
  setRememberMe: (val: boolean) => void
  onSubmit: (e: React.FormEvent) => void
  workSubmitting: boolean
  workLinkSent: boolean
  onResend: () => void
  onChangeEmail: () => void
  onBackToSignIn: () => void
  clearAuthError: () => void
}

function WorkEmailComingSoonPane({
  isDark,
  onBackToSignIn,
}: {
  isDark: boolean
  onBackToSignIn: () => void
}) {
  const u = getAuthStyles(isDark)

  return (
    <AuthStaggerGroup groupKey="work-email-coming-soon">
      <AuthStaggerItem>
        <p className={cn("shrink-0 text-center text-2xl font-black leading-tight tracking-tight sm:text-[1.65rem]", u.heading)}>
          Sign in with work email
        </p>
      </AuthStaggerItem>
      <AuthStaggerItem>
        <div className="mt-4 flex justify-center">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider",
              isDark
                ? "border-[#4be277]/30 bg-[#4be277]/10 text-[#4be277]"
                : "border-[#6b38d4]/25 bg-[#6b38d4]/8 text-[#6b38d4]",
            )}
          >
            Coming soon
          </span>
        </div>
      </AuthStaggerItem>
      <AuthStaggerItem>
        <p className={cn("mt-4 text-center text-sm leading-relaxed", u.bodySub)}>
          Passwordless sign-in with your work email is on the way. For now, use email &amp; password, Google, or Apple ID
          on the previous screen.
        </p>
      </AuthStaggerItem>
      <AuthStaggerItem>
        <button
          type="button"
          className={cn("mt-6 h-12 w-full rounded-xl text-sm", u.btnPrimary)}
          onClick={onBackToSignIn}
        >
          Back to Email &amp; Password Login
        </button>
      </AuthStaggerItem>
    </AuthStaggerGroup>
  )
}

export function LoginWorkEmailPane({
  isDark,
  isActive,
  pane,
  workEmail,
  setWorkEmail,
  rememberMe,
  setRememberMe,
  onSubmit,
  workSubmitting,
  workLinkSent,
  onResend,
  onChangeEmail,
  onBackToSignIn,
  clearAuthError,
}: LoginWorkEmailPaneProps) {
  const u = getAuthStyles(isDark)

  if (!WORK_EMAIL_LOGIN_ENABLED) {
    return (
      <AuthMotionPane isActive={isActive}>
        <WorkEmailComingSoonPane isDark={isDark} onBackToSignIn={onBackToSignIn} />
      </AuthMotionPane>
    )
  }

  return (
    <AuthMotionPane isActive={isActive}>
      <AuthCrossfade itemKey={pane}>
        {pane === "work-email" ? (
          <AuthStaggerGroup groupKey="work-email">
            <AuthStaggerItem>
              <p className={cn("shrink-0 text-center text-2xl font-black leading-tight tracking-tight sm:text-[1.65rem]", u.heading)}>
                Sign in with work email
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <p className={cn("mt-2 text-center text-sm leading-relaxed", u.bodySub)}>
                We&apos;ll email you a sign-in link. Open it in this browser to finish signing in.
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <form onSubmit={onSubmit} className="mt-6 space-y-3">
                <input
                  type="email"
                  value={workEmail}
                  onChange={(e) => {
                    clearAuthError()
                    setWorkEmail(e.target.value)
                  }}
                  className={cn("h-12 w-full px-4 text-sm", u.input)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  aria-label="Work email address"
                />
                <AuthCheckbox
                  id="vt-remember-me-work-email"
                  isDark={isDark}
                  checked={rememberMe}
                  onChange={setRememberMe}
                  label="Remember me on this device"
                />
                <button
                  type="submit"
                  disabled={workSubmitting}
                  className={cn("mt-1 h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                >
                  {workSubmitting ? "Sending…" : "Email me a link"}
                </button>
                <button type="button" className={cn("w-full pt-2 text-center text-sm", u.link)} onClick={onBackToSignIn}>
                  Back to Email &amp; Password Login
                </button>
              </form>
            </AuthStaggerItem>
          </AuthStaggerGroup>
        ) : null}

        {pane === "work-email-code" ? (
          <AuthStaggerGroup groupKey="work-email-code">
            <AuthStaggerItem>
              <p className={cn("shrink-0 text-center text-2xl font-black leading-tight tracking-tight sm:text-[1.65rem]", u.heading)}>
                Check your email
              </p>
            </AuthStaggerItem>
            <AuthStaggerItem>
              <p className={cn("mt-2 text-center text-sm leading-relaxed", u.bodySub)}>
                We sent a sign-in link to{" "}
                <span className={cn("font-semibold", u.bodyStrong)}>{workEmail || "your work email"}</span>. Open the
                link in this browser to finish. If the inbox is empty, check spam or request another link below.
              </p>
            </AuthStaggerItem>
            <AuthPresenceFade show={workLinkSent}>
              <AuthStaggerItem>
                <p
                  className={cn(
                    "mt-3 text-center text-xs font-medium leading-snug",
                    isDark ? "text-[#4be277]" : "text-[#6b38d4]",
                  )}
                >
                  Link request sent ✓
                </p>
              </AuthStaggerItem>
            </AuthPresenceFade>
            <AuthStaggerItem>
              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  className={cn("h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                  disabled={workSubmitting || !workEmail.trim()}
                  onClick={onResend}
                >
                  {workSubmitting ? "Sending…" : "Resend link"}
                </button>
                <button type="button" className={cn("w-full text-center text-sm", u.link)} onClick={onChangeEmail}>
                  Use a different email
                </button>
                <button type="button" className={cn("pt-1 text-center text-sm", u.link)} onClick={onBackToSignIn}>
                  Back to sign in
                </button>
              </div>
            </AuthStaggerItem>
          </AuthStaggerGroup>
        ) : null}
      </AuthCrossfade>
    </AuthMotionPane>
  )
}
