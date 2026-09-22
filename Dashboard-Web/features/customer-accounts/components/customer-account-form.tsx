"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ShieldCheck, Mail, Loader2 } from "lucide-react"
import { SimpleSelect } from "@/shared/ui/simple-select"
import {
  requestUnlockCode,
  verifyUnlockCode as verifyUnlockCodeApi,
  createCustomerAccount,
  UnlockError,
} from "@/features/customer-accounts/api/customer-accounts-api"
import type { CreateCustomerAccountResult, CustomerAccountRole } from "@/features/customer-accounts/models/customer-account"

const inputCls =
  "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

const CUSTOMER_ROLE_OPTIONS: CustomerAccountRole[] = ["Enterprise Manager", "Enterprise Super Manager"]

type Stage = "requesting" | "code" | "unlocked"

interface CustomerAccountFormProps {
  onCreated: (result: CreateCustomerAccountResult) => void
  onError: (message: string) => void
  /** Exposes whether a create is currently possible, so the parent modal can
   *  decide what its own footer/close behavior should do - this pane owns
   *  its own submit button rather than the shared "Send invites" footer,
   *  since the unlock step makes the available action here genuinely
   *  different from the other three tabs. */
  onBusyChange?: (busy: boolean) => void
}

/**
 * PLAN-customer-accounts-and-tenancy.md Phase 7: selecting this tab
 * immediately requests a verification code (US-1) and the create form does
 * not render at all until the code is verified - there is no "tab visible
 * but locked" state where the fields exist and are merely disabled. The
 * unlock token this resolves to lives in component state ONLY (never
 * localStorage, never a cookie): closing the modal drops it, which is the
 * entire mechanism behind "closing the tab locks it again" - nothing else
 * has to implement a lock, because there is nothing left to unlock once the
 * token is gone.
 */
export function CustomerAccountForm({ onCreated, onError, onBusyChange }: CustomerAccountFormProps) {
  const [stage, setStage] = useState<Stage>("requesting")
  const [code, setCode] = useState("")
  const [unlockToken, setUnlockToken] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [resendBusy, setResendBusy] = useState(false)
  const [expiresInMinutes, setExpiresInMinutes] = useState(10)

  const [email, setEmail] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [seats, setSeats] = useState("1")
  const [role, setRole] = useState<CustomerAccountRole>("Enterprise Manager")
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const requestedOnce = useRef(false)

  const doRequestCode = useCallback(() => {
    setStage("requesting")
    setCodeError(null)
    requestUnlockCode()
      .then(({ expiresInMinutes: mins }) => {
        setExpiresInMinutes(mins)
        setStage("code")
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : "Could not send a verification code."
        setCodeError(message)
        onError(message)
      })
  }, [onError])

  useEffect(() => {
    if (requestedOnce.current) return
    requestedOnce.current = true
    doRequestCode()
  }, [doRequestCode])

  async function handleVerify() {
    if (verifying || code.trim().length !== 6) return
    setVerifying(true)
    setCodeError(null)
    try {
      const token = await verifyUnlockCodeApi(code.trim())
      setUnlockToken(token)
      setStage("unlocked")
    } catch (e) {
      if (e instanceof UnlockError) {
        setCodeError(e.message)
        setAttemptsRemaining(e.attemptsRemaining ?? null)
      } else {
        setCodeError(e instanceof Error ? e.message : "Verification failed.")
      }
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (resendBusy) return
    setResendBusy(true)
    setCode("")
    setAttemptsRemaining(null)
    try {
      const { expiresInMinutes: mins } = await requestUnlockCode()
      setExpiresInMinutes(mins)
      setCodeError(null)
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : "Could not resend the code.")
    } finally {
      setResendBusy(false)
    }
  }

  async function handleCreate() {
    if (!unlockToken || submitting) return
    setFieldError(null)

    const trimmedEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFieldError("Enter a valid email address.")
      return
    }
    if (!periodEnd) {
      setFieldError("Choose when the paid period ends.")
      return
    }
    const periodEndIso = new Date(`${periodEnd}T23:59:59`).toISOString()
    if (new Date(periodEndIso).getTime() <= Date.now()) {
      setFieldError("The paid period must end in the future.")
      return
    }
    const seatsNum = Number(seats)
    if (!Number.isInteger(seatsNum) || seatsNum < 1) {
      setFieldError("Seats must be a whole number of at least 1.")
      return
    }

    setSubmitting(true)
    onBusyChange?.(true)
    try {
      const result = await createCustomerAccount(
        { email: trimmedEmail, periodEnd: periodEndIso, seats: seatsNum, role },
        unlockToken,
      )
      onCreated(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create the customer account."
      setFieldError(message)
      onError(message)
    } finally {
      setSubmitting(false)
      onBusyChange?.(false)
    }
  }

  if (stage === "requesting") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {codeError ? codeError : "Sending a verification code to your email…"}
        </p>
        {codeError ? (
          <button
            type="button"
            onClick={doRequestCode}
            className="text-xs font-semibold text-blue-500 dark:text-emerald-400 hover:underline"
          >
            Try again
          </button>
        ) : null}
      </div>
    )
  }

  if (stage === "code") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-5 text-center">
          <Mail className="h-6 w-6 text-blue-500 dark:text-emerald-400" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter the 6-digit code sent to your email. It expires in {expiresInMinutes} minutes and works once.
          </p>
        </div>
        <div>
          <label htmlFor="customer-unlock-code" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            VERIFICATION CODE
          </label>
          <input
            id="customer-unlock-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleVerify()
            }}
            placeholder="000000"
            className={`${inputCls} text-center text-lg tracking-[0.4em]`}
          />
        </div>
        {codeError ? (
          <p className="text-xs text-red-500">
            {codeError}
            {attemptsRemaining != null ? ` (${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} left)` : ""}
          </p>
        ) : null}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resendBusy}
            className="text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50"
          >
            {resendBusy ? "Sending…" : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={verifying || code.length !== 6}
            className="px-4 py-2 bg-blue-500 dark:bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 dark:hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "Verify"}
          </button>
        </div>
      </div>
    )
  }

  // stage === "unlocked"
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Verified. This unlock lasts until the modal is closed.</span>
      </div>

      <div className="space-y-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
        <div>
          <label htmlFor="customer-email" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            EMAIL*
          </label>
          <input
            id="customer-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@customer-company.com"
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="customer-period-end" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              PAID PERIOD ENDS*
            </label>
            <input
              id="customer-period-end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="customer-seats" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              SEATS*
            </label>
            <input
              id="customer-seats"
              type="number"
              min={1}
              step={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          ROLE*
        </label>
        <SimpleSelect value={role} onChange={(v) => setRole(v as CustomerAccountRole)} options={CUSTOMER_ROLE_OPTIONS} portalToBody />
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          The customer builds their own hierarchy under this role, up to their seat limit.
        </p>
      </div>

      {fieldError ? <p className="text-xs text-red-500">{fieldError}</p> : null}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={submitting}
          className="px-5 py-2 bg-blue-500 dark:bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 dark:hover:bg-emerald-500 transition-colors disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create customer account"}
        </button>
      </div>
    </div>
  )
}
