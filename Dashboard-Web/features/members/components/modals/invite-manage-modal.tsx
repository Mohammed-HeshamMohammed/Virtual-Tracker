"use client"

import { useEffect, useMemo, useState as useComponentState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, ChevronLeft, Mail, Settings } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  MANAGE_MODAL_TABS,
  MODAL_INPUT,
  MODAL_INPUT_GROUP,
  MODAL_INPUT_GROUP_FIELD,
  MODAL_INPUT_GROUP_SUFFIX,
  MODAL_LABEL,
  PAY_PERIODS,
} from "@/features/members/config/members-config"
import { SimpleDatePicker } from "@/shared/ui/simple-date-picker";
import { SimpleSelect } from "@/shared/ui/simple-select";
import { Toggle } from "@/shared/ui/toggle";
import type { Invite, InvitePatchBody, MemberEntryAction, MemberManageTab, MemberRole } from "@/features/members/models/member"
import { inviteWeeklyLimitPayloadFromInput, memberEntryToTab, parseUsdHrPayment, weeklyLimitInputFromStored } from "@/features/members/utils/member-utils"
import { PAY_RATE_CURRENCIES, parsePayRateDisplay } from "@/features/members/config/pay-currencies"

const PAY_RATE_CURRENCY_VALUES = PAY_RATE_CURRENCIES.map((c) => c.value)
import { validateEmailField, validatePayRate } from "@/shared/validation"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { useAuth } from "@/shared/providers/app"

export function InviteManageModal({
  open,
  openEntry,
  invite,
  onClose,
  onPatchInvite,
  onRemoveInvite,
  onNavigate,
}: {
  open: boolean
  openEntry: MemberEntryAction
  invite: Invite
  onClose: () => void
  onPatchInvite: (id: string, body: InvitePatchBody) => Promise<void>
  onRemoveInvite: (id: string) => void | Promise<void>
  onNavigate?: (id: string) => void
}) {
  const { memberRole } = useAuth()
  const assignableRoles = useMemo(() => listAssignableRoles(memberRole), [memberRole])
  const [activeTab, setActiveTab] = useComponentState<MemberManageTab>("info")
  const [headerMenuOpen, setHeaderMenuOpen] = useComponentState(false)
  const [busy, setBusy] = useComponentState(false)
  const [saveError, setSaveError] = useComponentState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useComponentState(false)
  const [isClosing, setIsClosing] = useComponentState(false)
  const handleClose = () => {
    setIsClosing(true)
    onClose()
  }

  const isPendingAccount = invite.listKind === "pending_account"

  const [editEmail, setEditEmail] = useComponentState("")
  const [role, setRole] = useComponentState<MemberRole>("Intern")
  const [payRate, setPayRate] = useComponentState("")
  const [currency, setCurrency] = useComponentState("USD")
  const [weeklyLimit, setWeeklyLimit] = useComponentState("")
  const [paySegment, setPaySegment] = useComponentState<"pay" | "bill">("pay")
  const [payPeriod, setPayPeriod] = useComponentState("None")

  const [prevId, setPrevId] = useComponentState<string | null>(null)
  const [prevOpen, setPrevOpen] = useComponentState(false)
  const [prevOpenEntry, setPrevOpenEntry] = useComponentState<MemberEntryAction | null>(null)

  if (open !== prevOpen || invite.id !== prevId || openEntry !== prevOpenEntry) {
    setPrevOpen(open)
    setPrevId(invite.id)
    setPrevOpenEntry(openEntry)
    if (open) {
      setIsClosing(false)
      setSaveError(null)
      setHeaderMenuOpen(false)
      setActiveTab(memberEntryToTab(openEntry))
      setRemoveConfirm(openEntry === "remove-member")
      setEditEmail(invite.email)
      setRole(invite.role)
      setPayRate(parseUsdHrPayment(invite.payment))
      setCurrency(parsePayRateDisplay(invite.payment).currency)
      setWeeklyLimit(weeklyLimitInputFromStored(invite.weeklyLimit))
      setPaySegment("pay")
      setPayPeriod("None")
    }
  }

  async function handleSave() {
    if (isPendingAccount) return
    const emailError = validateEmailField(editEmail, { label: "Email" })
    const payRateError = validatePayRate(payRate)
    const validationError = emailError ?? payRateError
    if (validationError) {
      setSaveError(validationError)
      return
    }
    const body: InvitePatchBody = {}
    const em = editEmail.trim()
    if (em && em !== invite.email) body.email = em
    const pr = Number(payRate)
    const curStr = parseUsdHrPayment(invite.payment)
    const curNum = curStr === "" ? 0 : Number(curStr)
    if (Number.isFinite(pr) && pr >= 0 && pr !== curNum) body.payRate = pr
    const curCurrency = parsePayRateDisplay(invite.payment).currency
    if (currency && currency !== curCurrency) body.currency = currency
    const nextWeekly = inviteWeeklyLimitPayloadFromInput(weeklyLimit)
    const prevWeekly = inviteWeeklyLimitPayloadFromInput(weeklyLimitInputFromStored(invite.weeklyLimit))
    if (nextWeekly !== prevWeekly) body.weeklyLimit = nextWeekly
    if (role !== invite.role) body.role = role

    setBusy(true)
    setSaveError(null)
    try {
      if (Object.keys(body).length > 0) await onPatchInvite(invite.id, body)
      handleClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setSaveError(null)
    try {
      await Promise.resolve(onRemoveInvite(invite.id))
      handleClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not remove this invite.")
    } finally {
      setBusy(false)
    }
  }

  function onHeaderManageProfile() {
    setHeaderMenuOpen(false)
    try {
      sessionStorage.setItem("vt-settings-members-pending:v1", JSON.stringify({ tab: "custom" }))
      sessionStorage.setItem("vt-custom-fields-sub:v1", "profile")
    } catch {}
    onNavigate?.("settings-members")
    handleClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-3 sm:p-6",
            isClosing && "pointer-events-none",
          )}
          onClick={() => !busy && handleClose()}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-h-[min(90vh,52rem)] w-full max-w-208 flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <button type="button" onClick={() => !busy && handleClose()} className="flex shrink-0 items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100">
                  <ChevronLeft className="h-4 w-4" />
                  Invites
                </button>
                <span className="hidden text-slate-300 dark:text-slate-700 sm:inline">/</span>
                <h1 className="truncate text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg">{invite.email}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="relative">
                  <button type="button" onClick={() => setHeaderMenuOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700/60">
                    Actions
                    <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  </button>
                  {headerMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-72" aria-hidden onClick={() => setHeaderMenuOpen(false)} />
                      <div className="absolute right-0 top-full z-81 mt-1 w-52 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 py-1 shadow-xl">
                        <button type="button" onClick={onHeaderManageProfile} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60">
                          <Settings className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                          Manage profile fields
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy || isPendingAccount}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-blue-500 dark:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 dark:hover:bg-emerald-500 disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>

            <div className="shrink-0 overflow-x-auto border-b border-slate-200 dark:border-slate-800 px-4">
              <div className="flex min-w-max gap-1">
                {MANAGE_MODAL_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      "border-b-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors sm:px-4 sm:text-sm",
                      activeTab === t.id ? "border-blue-500 dark:border-emerald-500 text-blue-600 dark:text-emerald-400" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 px-5 py-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60">
                <Mail className="h-5 w-5 text-blue-500 dark:text-blue-400" />
              </div>
              <div className="hidden h-10 w-px shrink-0 bg-slate-200 dark:bg-slate-700 sm:block" aria-hidden />
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <span className="break-all text-slate-600 dark:text-slate-300">{invite.email}</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 [&::-webkit-scrollbar]:hidden" style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
            >
              {isPendingAccount && (
                <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-sm text-amber-900 dark:text-amber-300">
                  This row is a pre-provisioned account: the user can sign in but has not completed first login yet. Remove here to delete the
                  pending Auth user and this row; role and pay cannot be edited from this list.
                </div>
              )}
              {saveError && <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-sm text-red-800 dark:text-red-300">{saveError}</div>}

              {activeTab === "info" && (
                <div className="space-y-6">
                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Identity</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className={MODAL_LABEL} htmlFor="fallback-id">Email</label>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className={MODAL_INPUT}
                          readOnly={isPendingAccount}
                          disabled={isPendingAccount} aria-label="Interactive control"
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === "roles" && (
                <div className="space-y-6">
                  <div>
                    <label className={MODAL_LABEL}>Role</label>
                    <SimpleSelect
                      value={role}
                      onChange={(v) => setRole(v as MemberRole)}
                      options={assignableRoles.length > 0 ? assignableRoles : [role]}
                      portalToBody
                      disabled={isPendingAccount}
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">Projects</h3>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                      {invite.projects === 0 ? "No projects assigned" : `${invite.projects} project(s)`}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">Teams</h3>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                      {invite.teams || "None"}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "payBill" && (
                <div className="space-y-6">
                  <div>
                    <span className={MODAL_LABEL}>Pay period</span>
                    <SimpleSelect value={payPeriod} onChange={setPayPeriod} options={PAY_PERIODS} portalToBody disabled={isPendingAccount} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 opacity-60">
                    <Toggle checked={false} onChange={() => {}} />
                    <span className="text-sm text-slate-600 dark:text-slate-400">Require timesheet approval</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={MODAL_LABEL}>Pay rate</label>
                      <div className="flex" aria-label="Interactive control">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={payRate}
                          onChange={(e) => setPayRate(e.target.value)}
                          className={cn(MODAL_INPUT, "rounded-r-none border-r-0")}
                          readOnly={isPendingAccount}
                          disabled={isPendingAccount}
                        />
                        <div className="w-24 shrink-0">
                          <SimpleSelect
                            value={currency}
                            onChange={setCurrency}
                            options={PAY_RATE_CURRENCY_VALUES}
                            disabled={isPendingAccount}
                            className="rounded-l-none"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className={MODAL_LABEL} aria-label="Interactive control">Effective date</label>
                      <SimpleDatePicker
                        value=""
                        onChange={() => {}}
                        placeholder="Select effective date"
                        disabled
                        aria-label="Effective date"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "workLimits" && (
                <div className="space-y-6">
                  <div>
                    <label className={MODAL_LABEL}>Weekly limit</label>
                    <div className={MODAL_INPUT_GROUP}>
                      <input
                        type="number"
                        min={0}
                        step={0.25}
                        inputMode="decimal"
                        value={weeklyLimit}
                        onChange={(e) => setWeeklyLimit(e.target.value)}
                        placeholder="No limit"
                        className={MODAL_INPUT_GROUP_FIELD}
                        readOnly={isPendingAccount}
                        disabled={isPendingAccount}
                      />
                      <span className={MODAL_INPUT_GROUP_SUFFIX}>hrs/wk</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "settings" && (
                <div className="space-y-8">
                  <section className="rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/30 p-4">
                    <h3 className="mb-2 text-sm font-bold text-red-900 dark:text-red-300">{isPendingAccount ? "Remove pending account" : "Remove invite"}</h3>
                    <p className="mb-3 text-sm text-red-800/90 dark:text-red-300/80">
                      {isPendingAccount
                        ? "Deletes the pending Auth user and frees this email. This cannot be undone."
                        : "Permanently remove this invite. This cannot be undone."}
                    </p>
                    {!removeConfirm ? (
                      <button type="button" onClick={() => setRemoveConfirm(true)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700">
                        {isPendingAccount ? "Remove pending account" : "Remove invite"}
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => void handleRemove()} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                          {busy ? "Removing…" : "Yes, remove permanently"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setRemoveConfirm(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60">Cancel</button>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
