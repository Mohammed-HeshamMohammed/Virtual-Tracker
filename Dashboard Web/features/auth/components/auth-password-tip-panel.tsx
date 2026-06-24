"use client"

import { AuthHelperPanel } from "@/features/auth/components/auth-side-panels"
import type { AuthStyles } from "@/features/auth/components/style-utils"

export function AuthPasswordTipPanel({ isDark, styles }: { isDark: boolean; styles: AuthStyles }) {
  return (
    <AuthHelperPanel title="Password tip" isDark={isDark} styles={styles}>
      <p>Longer passwords are often more secure than short, highly complex passwords.</p>
      <p>Consider using a memorable passphrase made of multiple words, numbers, and symbols.</p>
      <p>
        Example: <span className="font-mono text-[11px]">BlueCoffee!Train2026</span>
      </p>
      <p>Long, memorable passwords are easier to remember and significantly harder to crack.</p>
    </AuthHelperPanel>
  )
}

export function AuthEmailHelperPanel({
  isDark,
  styles,
  availability,
}: {
  isDark: boolean
  styles: AuthStyles
  availability: "checking" | "available" | "taken" | "idle"
}) {
  if (availability === "idle") return null

  const title =
    availability === "checking"
      ? "Checking email"
      : availability === "available"
        ? "Email available"
        : "Email unavailable"

  return (
    <AuthHelperPanel title={title} isDark={isDark} styles={styles}>
      {availability === "checking" ? <p>Checking whether this email is already registered…</p> : null}
      {availability === "available" ? (
        <p>This email address is available. You can use it to create your account.</p>
      ) : null}
      {availability === "taken" ? (
        <p>This email is already registered. Sign in instead, or use a different email address.</p>
      ) : null}
    </AuthHelperPanel>
  )
}
