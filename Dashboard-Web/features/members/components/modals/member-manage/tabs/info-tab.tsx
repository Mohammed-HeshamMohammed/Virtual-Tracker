"use client"

import { useCallback, useState } from "react"
import { CheckCircle2, Sparkles } from "lucide-react"
import { MODAL_INPUT, MODAL_INPUT_GROUP, MODAL_INPUT_GROUP_FIELD, MODAL_LABEL } from "@/features/members/config/members-config"
import { generateMemberEmployeeId } from "@/features/members/api/member-api"
import { PhoneVerifyControl } from "@/shared/ui/phone-verify-control"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import type { TabProps } from "@/features/members/components/modals/member-manage/types"

export function InfoTab({ member, state, setState, isSelfEdit = false, phoneVerifyRef }: TabProps) {
  const [generatingId, setGeneratingId] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const handleGenerateEmployeeId = useCallback(async () => {
    setGeneratingId(true)
    setGenerateError(null)
    try {
      const result = await generateMemberEmployeeId(member.id, {
        firstName: state.editFirst.trim() || undefined,
      })
      setState((s) => ({ ...s, employeeId: result.employeeId }))
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate employee ID")
    } finally {
      setGeneratingId(false)
    }
  }, [member.id, setState, state.editFirst])

  const handlePhoneVerificationChange = useCallback(
    (token: string | null, verified: boolean) => {
      setState((s) => ({
        ...s,
        phoneVerificationToken: token ?? "",
        phoneVerified: verified,
      }))
    },
    [setState],
  )

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={MODAL_LABEL} htmlFor="fallback-id">Employee ID</label>
            <div className={MODAL_INPUT_GROUP}>
              <input
                id="fallback-id"
                type="text"
                placeholder="Optional"
                value={state.employeeId}
                onChange={(e) => {
                  setGenerateError(null)
                  setState((s) => ({ ...s, employeeId: e.target.value }))
                }}
                className={MODAL_INPUT_GROUP_FIELD}
                aria-label="Employee ID"
              />
              <IconTooltip
                text="Generate a unique ID from name and org tree position"
                placement="top"
                multiline
              >
                <button
                  type="button"
                  onClick={() => void handleGenerateEmployeeId()}
                  disabled={generatingId}
                  aria-label="Generate employee ID"
                  className={cn(
                    "flex shrink-0 items-center gap-1 border-l border-slate-200 dark:border-slate-700 px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                    generatingId
                      ? "cursor-not-allowed bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                      : "bg-slate-50 dark:bg-slate-800 text-blue-600 dark:text-emerald-400 hover:bg-blue-50 dark:hover:bg-emerald-950/60 hover:text-blue-700 dark:hover:text-emerald-300",
                  )}
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  {generatingId ? "…" : "Generate"}
                </button>
              </IconTooltip>
            </div>
            {generateError ? (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{generateError}</p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                Uses first name + tree position; checks all existing IDs for uniqueness.
              </p>
            )}
          </div>
          <div>
            <label className={MODAL_LABEL}>Last IP</label>
            <IconTooltip
              text="Last known IP from this member's most recent sign-in."
              placement="top"
              multiline
            >
              <input
                type="text"
                value={(state.lastIp || member.lastIp)?.trim() || "—"}
                readOnly
                className={cn(MODAL_INPUT, "bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400")}
                aria-label="Last IP"
              />
            </IconTooltip>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Updated automatically when the member signs in. Not editable.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={MODAL_LABEL}>Name</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={state.editFirst}
                onChange={(e) => setState(s => ({ ...s, editFirst: sanitizePersonNameInput(e.target.value) }))}
                className={MODAL_INPUT}
                placeholder="First" aria-label="Interactive control"
              />
              <input
                type="text"
                value={state.editLast}
                onChange={(e) => setState(s => ({ ...s, editLast: sanitizePersonNameInput(e.target.value) }))}
                className={MODAL_INPUT}
                placeholder="Last"
              />
            </div>
          </div>
          <div aria-label="Interactive control">
            <label className={MODAL_LABEL}>Work email</label>
            <input
              type="email"
              value={state.editEmail}
              onChange={(e) => setState(s => ({ ...s, editEmail: e.target.value }))}
              className={MODAL_INPUT}
            />
          </div>
          <div>
            {isSelfEdit ? (
              <PhoneVerifyControl
                ref={phoneVerifyRef}
                phone={state.editPhone}
                onPhoneChange={(value) =>
                  setState((s) => ({
                    ...s,
                    editPhone: value,
                    phoneVerified: false,
                    phoneVerificationToken: "",
                  }))
                }
                verificationToken={state.phoneVerificationToken || null}
                onVerificationChange={handlePhoneVerificationChange}
                initiallyVerified={state.phoneVerified}
                confirmationMode="onSave"
                inputClassName={MODAL_INPUT}
                labelClassName={MODAL_LABEL}
              />
            ) : (
              <div className="space-y-2">
                <label className={MODAL_LABEL}>Phone number</label>
                <div className="relative">
                  <input
                    type="tel"
                    value={state.editPhone}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        editPhone: e.target.value,
                        phoneVerified: false,
                        phoneVerificationToken: "",
                      }))
                    }
                    placeholder="+1 (555) 123-4567 or +20 1xx xxx xxxx"
                    className={cn(
                      MODAL_INPUT,
                      state.phoneVerified &&
                        state.editPhone.trim() &&
                        "border-emerald-500/50 pr-23 focus:border-emerald-500/60 focus:ring-emerald-500/30",
                    )}
                    autoComplete="tel"
                  />
                  {state.phoneVerified && state.editPhone.trim() ? (
                    <span
                      className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 pr-3 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    >
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      Verified
                    </span>
                  ) : null}
                </div>
                {!state.phoneVerified && state.editPhone.trim() ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">Unverified — member must verify their own number</p>
                ) : null}
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Only this member can verify their phone from Profile or Manage myself after sign-in.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Contact</h3>
        <div className="grid gap-4 sm:grid-cols-2" aria-label="Interactive control">
          <div className="sm:col-span-2">
            <label className={MODAL_LABEL}>Personal email</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={state.editPersonalEmail}
              onChange={(e) => setState((s) => ({ ...s, editPersonalEmail: e.target.value }))}
              className={MODAL_INPUT}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
