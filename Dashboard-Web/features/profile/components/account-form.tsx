"use client"

import type { RefObject } from "react"
import { cn } from "@/shared/utils/utils"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import { PhoneVerifyControl, type PhoneVerifyControlHandle } from "@/shared/ui/phone-verify-control"

type AccountFormProps = {
  firstName: string
  setFirstName: (v: string) => void
  lastName: string
  setLastName: (v: string) => void
  email: string
  setEmail: (v: string) => void
  phone: string
  onPhoneChange: (value: string) => void
  phoneVerificationToken: string | null
  onPhoneVerificationChange: (token: string | null, verified: boolean) => void
  phoneInitiallyVerified: boolean
  payRateDisplay: string
  isDark: boolean
  emailInputRef: RefObject<HTMLInputElement | null>
  phoneVerifyRef: RefObject<PhoneVerifyControlHandle | null>
}

export function AccountForm({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  onPhoneChange,
  phoneVerificationToken,
  onPhoneVerificationChange,
  phoneInitiallyVerified,
  payRateDisplay,
  isDark,
  emailInputRef,
  phoneVerifyRef,
}: AccountFormProps) {
  const inputCls = cn(
    "w-full rounded-lg border px-3 py-2.5 text-sm transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400",
    isDark ? "border-white/10 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-700",
  )

  const labelCls = cn(
    "mb-1.5 block text-[10px] font-bold uppercase tracking-wider",
    isDark ? "text-[#bccbb9]" : "text-slate-400",
  )

  const card = isDark ? "border-white/10 bg-[#191f31]/80" : "border-slate-100 bg-white"
  const muted = isDark ? "text-[#bccbb9]" : "text-slate-500"

  return (
    <div className={cn("rounded-2xl border p-5 shadow-sm sm:p-7 lg:p-8", card)}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="profile-first-name">
            First name
          </label>
          <input
            id="profile-first-name"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(sanitizePersonNameInput(e.target.value))}
            autoComplete="given-name"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="profile-last-name">
            Last name
          </label>
          <input
            id="profile-last-name"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(sanitizePersonNameInput(e.target.value))}
            autoComplete="family-name"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-5">
        <label className={labelCls} htmlFor="profile-email">
          Email
        </label>
        <input
          ref={emailInputRef}
          id="profile-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={inputCls}
        />
        <p className={cn("mt-1.5 text-xs", muted)}>
          Changing your email updates your sign-in address. You may need to verify the new email.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-start">
        <div>
          <PhoneVerifyControl
            ref={phoneVerifyRef}
            phone={phone}
            onPhoneChange={onPhoneChange}
            verificationToken={phoneVerificationToken}
            onVerificationChange={onPhoneVerificationChange}
            initiallyVerified={phoneInitiallyVerified}
            confirmationMode="onSave"
            inputClassName={inputCls}
            labelClassName={labelCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="profile-pay-rate">
            Pay rate
          </label>
          <div
            className={cn(
              "flex w-full rounded-lg border",
              isDark ? "border-white/10 bg-[#151b2d]/60" : "border-slate-200 bg-slate-50",
            )}
          >
            <input
              id="profile-pay-rate"
              type="text"
              value={payRateDisplay ? `${payRateDisplay}` : "—"}
              readOnly
              className={cn(
                "min-w-0 flex-1 cursor-not-allowed rounded-l-lg border-0 bg-transparent px-3 py-2.5 text-sm",
                isDark ? "text-[#bccbb9]" : "text-slate-500",
              )}
            />
            <span
              className={cn(
                "flex items-center whitespace-nowrap rounded-r-lg border-l px-3 py-2 text-sm",
                isDark ? "border-white/10 text-[#bccbb9]" : "border-slate-200 text-slate-500",
              )}
            >
              USD/hr
            </span>
          </div>
          <p className={cn("mt-1.5 text-xs", muted)}>Set by your manager — not editable here.</p>
        </div>
      </div>
    </div>
  )
}
