"use client"

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { validatePhoneField } from "@/shared/validation"
import { usePhoneRecaptcha } from "@/features/auth/hooks/use-phone-recaptcha"
import { fetchPhoneVerificationConfig, type PhoneVerificationConfig } from "@/features/auth/services/backend-config"
import {
  confirmPhoneVerificationCode,
  phoneNumbersMatch,
  sendPhoneVerificationCode,
} from "@/features/auth/services/phone-verification-api"
import {
  confirmFirebasePhoneVerification,
  sendFirebasePhoneVerificationCode,
} from "@/features/auth/services/phone-verification-firebase"
import type { ConfirmationResult } from "firebase/auth"

const PHONE_VERIFY_CHANNEL_KEY = "vt_phone_verify_channel"

type PhoneVerifyChannel = "console" | "firebase"

/** inline = Verify button (register/invite). onSave = confirm OTP when parent Save runs (profile/manage myself). */
export type PhoneVerifyConfirmationMode = "inline" | "onSave"

export type PhoneVerifyControlHandle = {
  /** Confirms a pending OTP and returns a verification token, or null when phone is already verified / empty. */
  confirmPendingVerification: () => Promise<string | null>
  /** True when the phone field still needs verification before save. */
  requiresVerification: () => boolean
}

type PhoneVerifyControlProps = {
  phone: string
  onPhoneChange: (value: string) => void
  verificationToken: string | null
  onVerificationChange: (token: string | null, verified: boolean) => void
  initiallyVerified?: boolean
  required?: boolean
  inputClassName?: string
  labelClassName?: string
  disabled?: boolean
  confirmationMode?: PhoneVerifyConfirmationMode
}

function readStoredChannel(): PhoneVerifyChannel {
  if (typeof window === "undefined") return "console"
  const stored = window.sessionStorage.getItem(PHONE_VERIFY_CHANNEL_KEY)
  return stored === "firebase" ? "firebase" : "console"
}

function storeChannel(channel: PhoneVerifyChannel) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(PHONE_VERIFY_CHANNEL_KEY, channel)
}

export const PhoneVerifyControl = forwardRef<PhoneVerifyControlHandle, PhoneVerifyControlProps>(function PhoneVerifyControl(
  {
    phone,
    onPhoneChange,
    verificationToken,
    onVerificationChange,
    initiallyVerified = false,
    required = false,
    inputClassName,
    labelClassName,
    disabled = false,
    confirmationMode = "inline",
  },
  ref,
) {
  const { hostRef, createVerifier, dispose } = usePhoneRecaptcha()
  const [verificationConfig, setVerificationConfig] = useState<PhoneVerificationConfig | null>(null)
  const [devChannel, setDevChannel] = useState<PhoneVerifyChannel>("console")
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null)
  const [code, setCode] = useState("")
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(initiallyVerified ? phone.trim() : null)
  const [busy, setBusy] = useState<"send" | "confirm" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentHint, setSentHint] = useState<string | null>(null)

  const confirmOnSave = confirmationMode === "onSave"
  const showDevChannelPicker = verificationConfig?.allowFirebaseInDev === true
  const useConsoleOtp =
    verificationConfig?.mode === "dev" && (!showDevChannelPicker || devChannel === "console")
  const useFirebaseSms = verificationConfig?.mode === "firebase" || devChannel === "firebase"
  const canConfirm = useConsoleOtp ? Boolean(challengeId) : Boolean(firebaseConfirmation)

  const isVerified = useMemo(
    () =>
      Boolean(
        phone.trim() &&
          verifiedPhone &&
          phoneNumbersMatch(phone, verifiedPhone) &&
          (verificationToken || initiallyVerified),
      ),
    [phone, verifiedPhone, verificationToken, initiallyVerified],
  )

  const phoneNeedsVerification = Boolean(phone.trim() && !isVerified)

  useEffect(() => {
    if (initiallyVerified && phone.trim()) {
      setVerifiedPhone((prev) => (prev && phoneNumbersMatch(phone, prev) ? prev : phone.trim()))
    }
  }, [initiallyVerified, phone])

  useEffect(() => {
    setDevChannel(readStoredChannel())
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchPhoneVerificationConfig()
      .then((config) => {
        if (!cancelled) setVerificationConfig(config)
      })
      .catch(() => {
        if (!cancelled) setVerificationConfig({ mode: "firebase", allowFirebaseInDev: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!phone.trim()) {
      setVerifiedPhone(null)
      onVerificationChange(null, false)
      return
    }
    if (verifiedPhone && !phoneNumbersMatch(phone, verifiedPhone)) {
      setVerifiedPhone(null)
      onVerificationChange(null, false)
      setChallengeId(null)
      setFirebaseConfirmation(null)
      setCode("")
    }
  }, [phone, verifiedPhone, onVerificationChange])

  function resetPendingVerification() {
    setChallengeId(null)
    setFirebaseConfirmation(null)
    setCode("")
    setSentHint(null)
    setError(null)
    onVerificationChange(null, false)
    setVerifiedPhone(null)
  }

  function handleDevChannelChange(channel: PhoneVerifyChannel) {
    if (channel === devChannel) return
    setDevChannel(channel)
    storeChannel(channel)
    resetPendingVerification()
    dispose()
  }

  async function runConfirmCode(): Promise<string> {
    if (!canConfirm) {
      throw new Error("Send a verification code first.")
    }
    if (!/^\d{6}$/.test(code.trim())) {
      throw new Error("Enter the 6-digit verification code.")
    }
    const result = useConsoleOtp
      ? await confirmPhoneVerificationCode(challengeId!, code)
      : await confirmFirebasePhoneVerification(firebaseConfirmation!, code, phone)
    if (!phoneNumbersMatch(result.phone, phone)) {
      throw new Error("Verified number does not match the phone field.")
    }
    setVerifiedPhone(phone.trim())
    onVerificationChange(result.verificationToken, true)
    setChallengeId(null)
    setFirebaseConfirmation(null)
    dispose()
    return result.verificationToken
  }

  useImperativeHandle(
    ref,
    () => ({
      requiresVerification: () => phoneNeedsVerification,
      confirmPendingVerification: async () => {
        if (!phone.trim() || isVerified) {
          return verificationToken?.trim() || null
        }
        if (verificationToken?.trim() && verifiedPhone && phoneNumbersMatch(phone, verifiedPhone)) {
          return verificationToken.trim()
        }
        return runConfirmCode()
      },
    }),
    [phone, isVerified, verificationToken, verifiedPhone, phoneNeedsVerification, canConfirm, code, useConsoleOtp, challengeId, firebaseConfirmation],
  )

  async function handleSendCode() {
    if (!verificationConfig) {
      setError("Phone verification is still loading. Try again in a moment.")
      return
    }
    const validationError = validatePhoneField(phone, { required, label: "Phone number" })
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy("send")
    setError(null)
    setSentHint(null)
    setChallengeId(null)
    setFirebaseConfirmation(null)
    setCode("")
    try {
      if (useConsoleOtp) {
        const result = await sendPhoneVerificationCode(phone)
        setChallengeId(result.challengeId)
        setSentHint(
          confirmOnSave
            ? "Code sent. Enter it below, then click Save."
            : "Verification code sent. Check the Backend server console.",
        )
      } else {
        const confirmation = await sendFirebasePhoneVerificationCode(phone, createVerifier)
        setFirebaseConfirmation(confirmation)
        setSentHint(
          confirmOnSave ? "Code sent. Enter it below, then click Save." : "Verification code sent via Firebase SMS. Check your phone.",
        )
      }
    } catch (err) {
      dispose()
      setError(err instanceof Error ? err.message : "Could not send verification code.")
    } finally {
      setBusy(null)
    }
  }

  async function handleConfirmCode() {
    setBusy("confirm")
    setError(null)
    try {
      await runConfirmCode()
      setSentHint("Phone number verified.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.")
      onVerificationChange(null, false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {labelClassName ? <label className={labelClassName}>Phone number{required ? "*" : ""}</label> : null}
      <div className="relative">
        <input
          type="tel"
          value={phone}
          disabled={disabled}
          onChange={(e) => {
            setError(null)
            onPhoneChange(e.target.value)
          }}
          placeholder="+1 (555) 123-4567 or +20 1xx xxx xxxx"
          className={cn(inputClassName, isVerified && "border-emerald-500/50 pr-23 focus:border-emerald-500/60 focus:ring-emerald-500/30")}
          autoComplete="tel"
          aria-invalid={Boolean(error)}
        />
        {isVerified ? (
          <span
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 pr-3 text-[11px] font-semibold text-emerald-600"
            aria-hidden
          >
            <CheckCircle2 className="size-3.5 shrink-0" />
            Verified
          </span>
        ) : null}
      </div>
      {!isVerified && showDevChannelPicker ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Test channel</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={() => handleDevChannelChange("console")}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
                devChannel === "console" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              Console OTP
            </button>
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={() => handleDevChannelChange("firebase")}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
                devChannel === "firebase" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              Firebase SMS
            </button>
          </div>
        </div>
      ) : null}
      {!isVerified ? (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || busy !== null || !phone.trim() || !verificationConfig}
          onClick={() => void handleSendCode()}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "send" ? "Sending…" : "Send code"}
        </button>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          disabled={disabled || !canConfirm}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6-digit code"
          className={cn(
            "w-28 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400",
            disabled && "opacity-60",
          )}
        />
        {!confirmOnSave ? (
          <button
            type="button"
            disabled={disabled || busy !== null || !canConfirm || code.length !== 6}
            onClick={() => void handleConfirmCode()}
            className="rounded-lg bg-blue-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "confirm" ? "Verifying…" : "Verify"}
          </button>
        ) : null}
        {phone.trim() ? (
          <span className="text-[11px] text-amber-700">
            {confirmOnSave ? "Send code, enter it, then Save" : "Verification required before use"}
          </span>
        ) : null}
      </div>
      ) : null}
      {!isVerified && useConsoleOtp ? (
        <p className="text-[10px] text-slate-400">Console OTP: code is logged in the Backend terminal, not sent by SMS.</p>
      ) : null}
      {!isVerified && useFirebaseSms && showDevChannelPicker ? (
        <p className="text-[10px] text-slate-400">
          Firebase SMS: use a real number or add test numbers in Firebase Console → Authentication → Phone → Phone numbers for
          testing.
        </p>
      ) : null}
      {!isVerified && confirmOnSave && phoneNeedsVerification ? (
        <p className="text-[10px] text-slate-400">Phone verification completes when you click Save — other fields save at the same time.</p>
      ) : null}
      <div ref={hostRef} className="sr-only" aria-hidden />
      {sentHint ? <p className="text-[11px] text-slate-500">{sentHint}</p> : null}
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  )
})

PhoneVerifyControl.displayName = "PhoneVerifyControl"
