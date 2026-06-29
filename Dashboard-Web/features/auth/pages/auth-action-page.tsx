"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { AuthHeader } from "@/features/auth/components/auth-header"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { getFirebaseAuth, initFirebase } from "@/infrastructure/firebase/config"
import { notifyPasswordResetCompleted, notifyEmailVerified } from "@/features/auth/api/security-notify-api"
import {
  completeFirebaseEmailAction,
  completeFirebasePasswordReset,
  parseFirebaseEmailActionMode,
  readEmailVerificationTarget,
  readPasswordResetEmail,
  resolveEmailActionContinuePath,
  resolvePasswordResetContinuePath,
} from "@/features/auth/services/firebase-email-action"
import { formatAuthError } from "@/features/auth/services/format-auth-error"
import { validatePassword } from "@/shared/validation"
import { usePasswordPolicy } from "@/features/auth/services/password-policy"

type ActionState = "loading" | "ready" | "success" | "error" | "unsupported"

async function getReadyFirebaseAuth() {
  await initFirebase()
  return getFirebaseAuth()
}

export default function AuthActionPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isDark } = useTheme()
  const u = getAuthStyles(isDark)
  const { policy: passwordPolicy } = usePasswordPolicy()

  const mode = parseFirebaseEmailActionMode(searchParams.get("mode"))
  const oobCode = searchParams.get("oobCode")?.trim() ?? ""
  const continueUrl = searchParams.get("continueUrl")

  const [state, setState] = useState<ActionState>("loading")
  const [message, setMessage] = useState("Working…")
  const [resetEmail, setResetEmail] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (mode === "unknown") {
      setState("unsupported")
      setMessage("This sign-in link is not supported here. Return to Virtual Tracker and try again.")
      return
    }
    if (!oobCode) {
      setState("error")
      setMessage("This link is invalid or incomplete.")
      return
    }

    if (mode === "verifyEmail") {
      let cancelled = false
      void (async () => {
        try {
          const auth = await getReadyFirebaseAuth()
          const verifiedEmail = await readEmailVerificationTarget(auth, oobCode)
          await completeFirebaseEmailAction(auth, oobCode)
          if (verifiedEmail) {
            void notifyEmailVerified(verifiedEmail)
          }
          if (cancelled) return
          setState("success")
          setMessage("Your email has been verified. You can sign in now.")
          window.setTimeout(() => {
            router.replace(resolveEmailActionContinuePath(continueUrl))
          }, 1800)
        } catch (err) {
          if (cancelled) return
          setState("error")
          setMessage(formatAuthError(err) || "Could not verify your email.")
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (mode === "resetPassword") {
      let cancelled = false
      void (async () => {
        try {
          const email = await readPasswordResetEmail(await getReadyFirebaseAuth(), oobCode)
          if (cancelled) return
          setResetEmail(email)
          setState("ready")
          setMessage("Choose a new password for your account.")
        } catch (err) {
          if (cancelled) return
          setState("error")
          setMessage(formatAuthError(err) || "This password reset link is invalid or expired.")
        }
      })()
      return () => {
        cancelled = true
      }
    }

    setState("unsupported")
    setMessage("This sign-in link is not supported here. Return to Virtual Tracker and try again.")
  }, [continueUrl, mode, oobCode, router])

  async function handlePasswordResetSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!oobCode) return
    const validationError = validatePassword(newPassword, {
      confirmPassword,
      requireConfirm: true,
      policy: passwordPolicy.passwordPolicy,
    })
    if (validationError) {
      setMessage(validationError)
      setState("ready")
      return
    }
    setSubmitting(true)
    setMessage("Updating your password…")
    try {
      await completeFirebasePasswordReset(await getReadyFirebaseAuth(), oobCode, newPassword)
      if (resetEmail) {
        void notifyPasswordResetCompleted(resetEmail)
      }
      setState("success")
      setMessage("Your password was reset successfully. You can sign in now.")
      window.setTimeout(() => {
        router.replace(resolvePasswordResetContinuePath(continueUrl))
      }, 1800)
    } catch (err) {
      setState("error")
      setMessage(formatAuthError(err) || "Could not reset your password.")
    } finally {
      setSubmitting(false)
    }
  }

  const heading =
    mode === "resetPassword"
      ? state === "success"
        ? "Password updated"
        : state === "error"
          ? "Try resetting again"
          : "Reset your password"
      : mode === "verifyEmail"
        ? state === "error"
          ? "Try verifying your email again"
          : "Verify your email"
        : "Sign-in link"

  return (
    <div
      className={cn(
        "relative flex min-h-dvh flex-col overflow-hidden transition-colors duration-300",
        u.shell,
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div
          className={cn(
            "absolute -left-32 -top-32 h-96 w-96 rounded-full blur-[100px]",
            isDark ? "bg-[#4be277]/6" : "bg-[#6b38d4]/5",
          )}
        />
        <div
          className={cn(
            "absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-[100px]",
            isDark ? "bg-[#22c55e]/5" : "bg-[#5a2db8]/4",
          )}
        />
      </div>

      <AuthHeader isDark={isDark} onRequestAccess={() => router.replace("/")} />

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-16 sm:px-6">
        <section className="w-full max-w-[452px]">
          <div className={cn("flex w-full flex-col rounded-2xl px-6 pb-6 pt-7 sm:px-7", u.card)}>
            <div className="mb-5 flex justify-center">
              {state === "loading" || submitting ? (
                <Loader2 className={cn("h-10 w-10 animate-spin", isDark ? "text-[#4be277]" : "text-[#6b38d4]")} />
              ) : state === "success" ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              ) : state === "error" || state === "unsupported" ? (
                <AlertCircle className="h-10 w-10 text-red-500" />
              ) : (
                <CheckCircle2 className={cn("h-10 w-10", isDark ? "text-[#4be277]" : "text-[#6b38d4]")} />
              )}
            </div>

            <h1 className={cn("text-center text-2xl font-black tracking-tight", u.heading)}>{heading}</h1>

            {mode === "resetPassword" && state === "ready" ? (
              <form onSubmit={(e) => void handlePasswordResetSubmit(e)} className="mt-5 space-y-4">
                {resetEmail ? (
                  <p className={cn("text-center text-sm", u.bodySub)}>Resetting password for {resetEmail}</p>
                ) : null}
                <div>
                  <label className={cn("mb-1.5 block text-[10px] font-bold uppercase tracking-wider", u.bodySub)}>
                    New password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className={cn("h-11 w-full rounded-xl px-3 text-sm", u.input)}
                  />
                </div>
                <div>
                  <label className={cn("mb-1.5 block text-[10px] font-bold uppercase tracking-wider", u.bodySub)}>
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className={cn("h-11 w-full rounded-xl px-3 text-sm", u.input)}
                  />
                </div>
                <button type="submit" disabled={submitting} className={cn("h-11 w-full rounded-xl text-sm", u.btnPrimary)}>
                  {submitting ? "Updating…" : "Update password"}
                </button>
              </form>
            ) : (
              <p className={cn("mt-3 text-center text-sm leading-relaxed", u.bodySub)}>{message}</p>
            )}

            {state !== "loading" && state !== "ready" && !submitting ? (
              <button
                type="button"
                onClick={() =>
                  router.replace(
                    state === "success" && mode === "resetPassword"
                      ? resolvePasswordResetContinuePath(continueUrl)
                      : state === "success"
                        ? resolveEmailActionContinuePath(continueUrl)
                        : "/",
                  )
                }
                className={cn("mt-6 h-11 w-full rounded-xl text-sm", u.btnPrimary)}
              >
                {state === "success" ? "Continue to sign in" : "Back to sign in"}
              </button>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
