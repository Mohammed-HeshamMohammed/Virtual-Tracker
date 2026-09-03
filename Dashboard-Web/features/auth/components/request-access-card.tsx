"use client"

import React, { useState as useComponentState } from "react"
import { cn } from "@/shared/utils/utils"
import { submitAccessRequest } from "@/features/auth/services/access-request"
import { isValidEmail, validateRequiredText } from "@/shared/validation"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import {
  AuthCrossfade,
  AuthMotionPane,
  AuthPresenceFade,
  AuthStaggerGroup,
  AuthStaggerItem,
} from "@/features/auth/components/auth-motion"

const REQUEST_ACCESS_ENABLED = false

interface RequestAccessCardProps {
  isDark: boolean
  isActive: boolean
  onBackToLogin: (options?: { resetRequestForm?: boolean }) => void
}

function RequestAccessComingSoonPane({
  isDark,
  onBackToLogin,
}: {
  isDark: boolean
  onBackToLogin: () => void
}) {
  const u = getAuthStyles(isDark)

  return (
    <AuthStaggerGroup groupKey="request-access-coming-soon">
      <AuthStaggerItem>
        <h2
          className={cn(
            "shrink-0 text-center text-3xl font-black leading-tight tracking-tight sm:text-[2rem]",
            u.heading,
          )}
        >
          Request access
        </h2>
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
          Self-service access requests are on the way. For now, sign in with an existing account or contact your workspace
          admin for an invite.
        </p>
      </AuthStaggerItem>
      <AuthStaggerItem>
        <button
          type="button"
          className={cn("mt-6 h-12 w-full rounded-xl text-sm", u.btnPrimary)}
          onClick={onBackToLogin}
        >
          Back to sign in
        </button>
      </AuthStaggerItem>
    </AuthStaggerGroup>
  )
}

export function RequestAccessCard({ isDark, isActive, onBackToLogin }: RequestAccessCardProps) {
  const u = getAuthStyles(isDark)

  const [requestName, setRequestName] = useComponentState("")
  const [requestEmail, setRequestEmail] = useComponentState("")
  const [requestMobile, setRequestMobile] = useComponentState("")
  const [requestSubmitting, setRequestSubmitting] = useComponentState(false)
  const [requestSent, setRequestSent] = useComponentState(false)
  const [requestError, setRequestError] = useComponentState<string | null>(null)

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRequestError(null)
    const nameError = validateRequiredText(requestName, "Name")
    const emailError = !isValidEmail(requestEmail.trim()) ? "Enter a valid email address." : null
    const validationError = nameError ?? emailError
    if (validationError) {
      setRequestError(validationError)
      return
    }
    setRequestSubmitting(true)
    try {
      await submitAccessRequest({
        name: requestName.trim(),
        email: requestEmail.trim(),
        phone: requestMobile.trim(),
      })
      setRequestSent(true)
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setRequestSubmitting(false)
    }
  }

  const handleBackToLogin = (reset = false) => {
    if (reset) {
      setRequestName("")
      setRequestEmail("")
      setRequestMobile("")
      setRequestSent(false)
      setRequestError(null)
    }
    onBackToLogin({ resetRequestForm: reset })
  }

  return (
    <AuthMotionPane isActive={isActive}>
      {!REQUEST_ACCESS_ENABLED ? (
        <RequestAccessComingSoonPane isDark={isDark} onBackToLogin={() => onBackToLogin()} />
      ) : (
        <>
      <AuthStaggerGroup groupKey="request-header">
        <AuthStaggerItem>
          <h2
            className={cn(
              "shrink-0 pb-4 text-center text-3xl font-black leading-tight tracking-tight sm:text-[2rem]",
              u.heading,
            )}
          >
            Request access
          </h2>
        </AuthStaggerItem>
        <AuthStaggerItem>
          <p className={cn("shrink-0 text-center text-sm leading-relaxed sm:text-base", u.body)}>
            Share your details so we can follow up about Virtual Tracker.
            <br />
            <span className={cn("text-xs sm:text-sm", u.bodySub)}>
              Submitted to your workspace once it's set up and reachable.
            </span>
          </p>
        </AuthStaggerItem>
      </AuthStaggerGroup>

      <div className="mt-6">
        <AuthCrossfade itemKey={requestSent ? "sent" : "form"}>
          {requestSent ? (
            <div className="space-y-4 text-center">
              <div
                className={cn(
                  "mx-auto flex h-14 w-14 items-center justify-center rounded-full",
                  isDark ? "bg-[#4be277]/15" : "bg-[#6b38d4]/10",
                )}
              >
                <svg
                  className={cn("h-7 w-7", isDark ? "text-[#4be277]" : "text-[#6b38d4]")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className={cn("text-sm leading-relaxed", u.body)}>
                Thanks — your request was received. We&apos;ll be in touch soon.
              </p>
              <button
                type="button"
                onClick={() => handleBackToLogin(true)}
                className={cn("h-12 w-full rounded-xl text-sm", u.btnOutline)}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequestSubmit}>
              <AuthStaggerGroup groupKey="request-form" className="space-y-3">
                <AuthPresenceFade show={Boolean(requestError)}>
                  <AuthStaggerItem>
                    <p className="text-center text-xs text-red-500" role="alert">
                      {requestError}
                    </p>
                  </AuthStaggerItem>
                </AuthPresenceFade>
                <AuthStaggerItem>
                  <input
                    type="text"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    className={cn("h-12 w-full px-4 text-sm", u.input)}
                    placeholder="Full name"
                    autoComplete="name"
                    required
                    aria-label="Full name"
                  />
                </AuthStaggerItem>
                <AuthStaggerItem>
                  <input
                    type="email"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    className={cn("h-12 w-full px-4 text-sm", u.input)}
                    placeholder="Email"
                    autoComplete="email"
                    required
                    aria-label="Email"
                  />
                </AuthStaggerItem>
                <AuthStaggerItem>
                  <input
                    type="tel"
                    value={requestMobile}
                    onChange={(e) => setRequestMobile(e.target.value)}
                    className={cn("h-12 w-full px-4 text-sm", u.input)}
                    placeholder="Mobile number"
                    autoComplete="tel"
                    required
                    aria-label="Mobile number"
                  />
                </AuthStaggerItem>
                <AuthStaggerItem>
                  <button
                    type="submit"
                    disabled={requestSubmitting}
                    className={cn("mt-2 h-12 w-full rounded-xl text-sm", u.btnPrimary)}
                  >
                    {requestSubmitting ? "Sending…" : "Send request"}
                  </button>
                </AuthStaggerItem>
                <AuthStaggerItem>
                  <button
                    type="button"
                    onClick={() => handleBackToLogin(false)}
                    className={cn("w-full pt-2 text-center text-sm", u.link)}
                  >
                    Back to sign in
                  </button>
                </AuthStaggerItem>
              </AuthStaggerGroup>
            </form>
          )}
        </AuthCrossfade>
      </div>
        </>
      )}
    </AuthMotionPane>
  )
}
