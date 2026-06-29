"use client"

import { useState } from "react"
import { cn } from "@/shared/utils/utils"
import { AuthHelperPanel } from "@/features/auth/components/auth-side-panels"
import { EMAIL_VERIFICATION_REQUIRED_MESSAGE } from "@/features/auth/services/email-verification"
import type { AuthStyles } from "@/features/auth/components/style-utils"

type EmailVerificationSidePanelProps = {
  isDark: boolean
  styles: AuthStyles
  email: string
  message: string | null
  error: string | null
  onResend: () => Promise<void>
}

export function EmailVerificationSidePanel({
  isDark,
  styles,
  email,
  message,
  error,
  onResend,
}: EmailVerificationSidePanelProps) {
  const [resending, setResending] = useState(false)

  async function handleResend() {
    setResending(true)
    try {
      await onResend()
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthHelperPanel title="Verify your email" isDark={isDark} styles={styles}>
      <p>{EMAIL_VERIFICATION_REQUIRED_MESSAGE}</p>
      {email ? <p className={cn("font-semibold", styles.bodyStrong)}>{email}</p> : null}
      <p>After you verify, press <span className="font-semibold">Sign in</span> again.</p>
      {message ? <p className="text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : null}
      <button
        type="button"
        disabled={resending}
        onClick={() => void handleResend()}
        className={cn("mt-1 h-10 w-full rounded-lg text-sm", styles.btnPrimary)}
      >
        {resending ? "Sending…" : "Resend verification email"}
      </button>
    </AuthHelperPanel>
  )
}
