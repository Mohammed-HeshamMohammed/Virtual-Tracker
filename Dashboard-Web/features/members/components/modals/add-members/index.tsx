/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/js-combine-iterations */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { X, Share2 } from "lucide-react"
import { copyTextToClipboard } from "@/shared/utils/clipboard"
import { cn } from "@/shared/utils/utils"
import { MAX_INVITES_PER_SUBMIT } from "@/features/members/config/members-config"
import type { AddMembersResult, AddMembersSubmission, MemberRole, AccountFormFields, InviteFormRow, MigratableAuthUser } from "@/features/members/models/member"
import { InviteForm } from "@/features/members/components/modals/add-members/invite-form"
import { AccountForm } from "@/features/members/components/modals/add-members/account-form"
import { MigrateForm } from "@/features/members/components/modals/add-members/migrate-form"
import { validateEmailsForAddMembers, fetchMigratableUsers } from "@/features/members/api/member-api"
import { isValidEmail, validateEmailField, validatePayRate, validatePersonName } from "@/shared/validation"
import { sanitizePersonNameInput } from "@/shared/validation/person-name"
import { NotifyToastHost } from "@/shared/ui/layout"
import type { NotifyAlertTone } from "@/shared/ui/alert-notify"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { canMigrateMembers } from "@/features/auth"
import { useAuth } from "@/shared/providers/app"
import { resolveInviteUrl } from "@/features/members/api/member-api"

export interface AddMembersModalProps {
  onClose: () => void
  onAdd: (payload: AddMembersSubmission) => Promise<AddMembersResult>
  onShareLink?: (payload: { role: MemberRole }) => Promise<{
    inviteUrl: string
    expiresAt: string | null
    maxUses: number
  }>
  onPending?: (payload: AddMembersSubmission) => void
  onSuccess?: (result: AddMembersResult) => void
  onError?: (message: string) => void
}

export function formatAddMembersPending(payload: AddMembersSubmission): { title: string; message: string } {
  if (payload.mode === "invites") {
    const count = payload.rows.length
    return {
      title: "Add members",
      message: `Sending ${count} invite${count === 1 ? "" : "s"}…`,
    }
  }
  if (payload.mode === "migrate") {
    const count = payload.migrations.length
    return {
      title: "Add members",
      message: `Migrating ${count} member${count === 1 ? "" : "s"}…`,
    }
  }
  const email = payload.rows[0]?.email ?? "member"
  return {
    title: "Add members",
    message: `Creating account for ${email}…`,
  }
}

export function formatAddMembersSuccess(result: AddMembersResult): { message: string; tone: NotifyAlertTone } {
  if (result.mode === "invites") {
    const linkBlock =
      result.inviteUrls.length > 0
        ? `\n\nInvite link${result.inviteUrls.length === 1 ? "" : "s"}:\n${result.inviteUrls.join("\n")}`
        : ""
    if (result.emailsSent > 0 && result.emailsFailed === 0) {
      return {
        tone: "info",
        message: `${result.count} invite${result.count === 1 ? "" : "s"} sent successfully.${linkBlock}`,
      }
    }
    if (result.emailsSent > 0 && result.emailsFailed > 0) {
      return {
        tone: "info",
        message: `${result.emailsSent} invite(s) emailed. ${result.emailsFailed} could not be delivered — share links manually:${linkBlock || `\n${result.inviteUrls.join("\n")}`}`,
      }
    }
    if (result.emailConfigured && result.emailChannel?.endsWith("_failed")) {
      return {
        tone: "info",
        message: `Invite created, but email delivery failed (Gmail/SMTP rejected login — check SMTP_PASS is a valid App Password for a Google account). Share this link manually:${linkBlock}`,
      }
    }
    return {
      tone: "info",
      message:
        result.inviteUrls.length > 0
          ? `Email delivery is not configured on the server. Invite created — copy this link and send it to the recipient manually:${linkBlock}\n\nAdd RESEND_API_KEY or SMTP settings to Backend/.env to send email automatically.`
          : `${result.count} invite(s) created, but no invite link was returned. Configure Backend/.env (RESEND_API_KEY or SMTP_*).`,
    }
  }

  if (result.mode === "migrate") {
    const succeeded = result.results.filter((r) => r.success).length
    const failed = result.results.length - succeeded
    if (failed === 0) {
      return { tone: "info", message: `${succeeded} member${succeeded === 1 ? "" : "s"} migrated successfully.` }
    }
    const failedList = result.results
      .filter((r) => !r.success)
      .map((r) => `${r.uid}: ${r.error}`)
      .join("\n")
    return {
      tone: "info",
      message: `${succeeded} migrated, ${failed} failed.\n\n${failedList}`,
    }
  }

  if (result.emailSent) {
    return {
      tone: "info",
      message: `Account created. Welcome email sent to ${result.email}.`,
    }
  }
  if (result.tempPassword) {
    return {
      tone: "info",
      message: `Account created. Email delivery is not configured — share these credentials securely:\n\nEmail: ${result.email}\nTemporary password: ${result.tempPassword}\n\nThey must change their password on first sign-in.\n\nAdd RESEND_API_KEY or SMTP_* to Backend/.env to email credentials automatically.`,
    }
  }
  return { tone: "info", message: `Account created for ${result.email}.` }
}

const MODAL_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const TAB_SLIDE_PX = 20

export function AddMembersModal({ onClose, onAdd, onShareLink, onPending, onSuccess, onError }: AddMembersModalProps) {
  const reduceMotion = useReducedMotion()
  const modalTransition = reduceMotion ? { duration: 0 } : { duration: 0.24, ease: MODAL_EASE }
  const paneTransition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: MODAL_EASE }
  const { memberRole } = useAuth()
  const assignableRoles = useMemo(() => listAssignableRoles(memberRole), [memberRole])
  const defaultRole = assignableRoles[assignableRoles.length - 1] ?? "Viewer"
  const canMigrate = canMigrateMembers(memberRole ?? "")

  const [mode, setMode] = useComponentState<"invites" | "accounts" | "migrate">("invites")
  const [isSubmitting, setIsSubmitting] = useComponentState(false)
  // If the exit animation's deferred unmount ever stalls, this invisible fixed-inset-0
  // backdrop would keep intercepting every click/hover on the dashboard underneath it.
  // Kill pointer-events the instant close is requested, independent of animation state.
  const [isClosing, setIsClosing] = useComponentState(false)
  const handleClose = useCallback(() => {
    setIsClosing(true)
    onClose()
  }, [onClose])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleClose])

  // Send invites state
  const [inviteRows, setInviteRows] = useComponentState<InviteFormRow[]>([{ email: "", payRate: "", currency: "USD" }])
  const [inviteRole, setInviteRole] = useComponentState<MemberRole>(defaultRole)

  // Create accounts state
  const [accountForm, setAccountForm] = useComponentState<AccountFormFields>({
    firstName: "",
    lastName: "",
    email: "",
    payRate: "",
    currency: "USD",
  })
  const [accountRole, setAccountRole] = useComponentState<MemberRole>(defaultRole)
  const [sendWelcomeEmail, setSendWelcomeEmail] = useComponentState(true)

  // Migrate existing Firebase Auth users state — role is auto-suggested per person, not picked from a shared dropdown.
  const [migratableUsers, setMigratableUsers] = useComponentState<MigratableAuthUser[]>([])
  const [migrateNextPageToken, setMigrateNextPageToken] = useComponentState<string | null>(null)
  const [migrateSelectedUids, setMigrateSelectedUids] = useComponentState<Set<string>>(new Set())
  const [migrateFilterText, setMigrateFilterText] = useComponentState("")
  const [migrateLoading, setMigrateLoading] = useComponentState(false)
  const [migrateLoadedOnce, setMigrateLoadedOnce] = useComponentState(false)

  const [toast, setToast] = useComponentState<{ message: string; title: string; tone: NotifyAlertTone } | null>(null)
  const [shareLinkBusy, setShareLinkBusy] = useComponentState(false)
  const prevModeRef = useRef<"invites" | "accounts" | "migrate">("invites")
  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  useEffect(() => {
    if (!assignableRoles.includes(inviteRole)) {
      setInviteRole(defaultRole)
    }
    if (!assignableRoles.includes(accountRole)) {
      setAccountRole(defaultRole)
    }
    if (mode === "migrate" && !canMigrate) {
      setMode("invites")
    }
  }, [assignableRoles, defaultRole, inviteRole, accountRole, mode, canMigrate])

  /** Suggested role clamped to what the viewer may actually assign; falls back to the lowest assignable role. */
  const resolveMigrateRole = useCallback(
    (user: MigratableAuthUser): MemberRole =>
      user.suggestedRole && assignableRoles.includes(user.suggestedRole) ? user.suggestedRole : defaultRole,
    [assignableRoles, defaultRole],
  )

  useEffect(() => {
    if (mode !== "migrate" || migrateLoadedOnce) return
    setMigrateLoadedOnce(true)
    setMigrateLoading(true)
    fetchMigratableUsers()
      .then(({ users, nextPageToken }) => {
        setMigratableUsers(users)
        setMigrateNextPageToken(nextPageToken)
      })
      .catch((e) => {
        setToast({
          title: "Migrate",
          tone: "error",
          message: e instanceof Error ? e.message : "Could not load unlinked accounts.",
        })
      })
      .finally(() => setMigrateLoading(false))
  }, [mode, migrateLoadedOnce])

  function toggleMigrateUid(uid: string) {
    setMigrateSelectedUids((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function toggleMigrateUids(uids: string[], selected: boolean) {
    setMigrateSelectedUids((prev) => {
      const next = new Set(prev)
      for (const uid of uids) {
        if (selected) next.add(uid)
        else next.delete(uid)
      }
      return next
    })
  }

  function loadMoreMigratable() {
    if (!migrateNextPageToken || migrateLoading) return
    setMigrateLoading(true)
    fetchMigratableUsers({ pageToken: migrateNextPageToken })
      .then(({ users, nextPageToken }) => {
        setMigratableUsers((prev) => [...prev, ...users])
        setMigrateNextPageToken(nextPageToken)
      })
      .catch((e) => {
        setToast({
          title: "Migrate",
          tone: "error",
          message: e instanceof Error ? e.message : "Could not load more accounts.",
        })
      })
      .finally(() => setMigrateLoading(false))
  }

  function addInviteRow() {
    setInviteRows((prev) =>
      prev.length >= MAX_INVITES_PER_SUBMIT ? prev : [...prev, { email: "", payRate: "", currency: "USD" }],
    )
  }

  function removeInviteRow(index: number) {
    setInviteRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function updateInviteRow(i: number, field: "email" | "payRate" | "currency", val: string) {
    setInviteRows((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)))
  }

  function updateAccountField(field: keyof AccountFormFields, val: string) {
    const nextVal = field === "firstName" || field === "lastName" ? sanitizePersonNameInput(val) : val
    setAccountForm((prev) => ({ ...prev, [field]: nextVal }))
  }

  function formatShareLinkExpiry(expiresAt: string | null): string {
    if (!expiresAt) return "7 days"
    const parsed = Date.parse(expiresAt)
    if (!Number.isFinite(parsed)) return "7 days"
    return new Date(parsed).toLocaleString()
  }

  async function handleShareInviteLink() {
    if (!onShareLink || shareLinkBusy || isSubmitting) return
    setToast(null)
    setShareLinkBusy(true)
    try {
      const result = await onShareLink({ role: inviteRole })
      const inviteUrl = resolveInviteUrl(result.inviteUrl)
      const copied = await copyTextToClipboard(inviteUrl)
      const expiryLabel = formatShareLinkExpiry(result.expiresAt)
      setToast({
        title: "Share invite link",
        tone: "info",
        message: copied
          ? `Link copied to clipboard.\n\nValid until ${expiryLabel}. Single use only — it stops working after one person joins.`
          : `Invite link created.\n\n${inviteUrl}\n\nValid until ${expiryLabel}. Single use only — it stops working after one person joins.`,
      })
    } catch (e) {
      setToast({
        title: "Share invite link",
        tone: "error",
        message: e instanceof Error ? e.message : "Could not create invite link.",
      })
    } finally {
      setShareLinkBusy(false)
    }
  }

  async function handleSend() {
    if (isSubmitting) return
    setToast(null)

    if (mode === "invites") {
// eslint-disable-next-line react-doctor/js-flatmap-filter
      const rows = inviteRows
        .map((row) => ({ email: row.email.trim(), payRate: row.payRate.trim(), currency: row.currency || "USD" }))
        .filter((row) => row.email.length > 0)
        .slice(0, MAX_INVITES_PER_SUBMIT)
      if (rows.length === 0) return

      const invalidEmail = rows.find((row) => !isValidEmail(row.email))
      if (invalidEmail) {
        setToast({ message: `Enter a valid email: ${invalidEmail.email}`, title: "Add members", tone: "error" })
        return
      }
      const invalidPayRate = rows.find((row) => row.payRate.trim() && validatePayRate(row.payRate))
      if (invalidPayRate) {
        setToast({ message: validatePayRate(invalidPayRate.payRate)!, title: "Add members", tone: "error" })
        return
      }

      setIsSubmitting(true)
      try {
        const emails = rows.map((r) => r.email)
        const seen = new Set<string>()
        for (const em of emails) {
          const k = em.toLowerCase()
          if (seen.has(k)) {
            setToast({ message: `Duplicate email in this list: ${em}`, title: "Add members", tone: "error" })
            return
          }
          seen.add(k)
        }
        const check = await validateEmailsForAddMembers(emails)
        if (!check.allOk) {
          const bad = check.results.filter((r) => !r.ok)
          setToast({
            message: bad.map((r) => (r.message ? `${r.email}: ${r.message}` : r.email)).join("\n"),
            title: "Add members",
            tone: "error",
          })
          return
        }
        const payload: AddMembersSubmission = {
          mode: "invites",
          rows,
          role: inviteRole,
        }
        onPending?.(payload)
        handleClose()
        void onAdd(payload)
          .then((result) => onSuccess?.(result))
          .catch((e) =>
            onError?.(e instanceof Error ? e.message : "Could not send invites."),
          )
      } catch (e) {
        setToast({
          message: e instanceof Error ? e.message : "Email check failed.",
          title: "Add members",
          tone: "error",
        })
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    if (mode === "migrate") {
      const selected = migratableUsers.filter((u) => migrateSelectedUids.has(u.uid))
      if (selected.length === 0) {
        setToast({ message: "Select at least one account to migrate.", title: "Add members", tone: "error" })
        return
      }
      setIsSubmitting(true)
      const migrations = selected.map((u) => ({ uid: u.uid, role: resolveMigrateRole(u) }))
      const payload: AddMembersSubmission = { mode: "migrate", migrations }
      onPending?.(payload)
      handleClose()
      void onAdd(payload)
        .then((result) => onSuccess?.(result))
        .catch((e) => onError?.(e instanceof Error ? e.message : "Could not migrate members."))
      setIsSubmitting(false)
      return
    }

    const first = accountForm.firstName.trim()
    const last = accountForm.lastName.trim()
    const name = [first, last].filter(Boolean).join(" ").trim()
    const email = accountForm.email.trim()
    const nameError = validatePersonName(first, last)
    const emailError = validateEmailField(email, { label: "Email" })
    const payRateError = accountForm.payRate.trim() ? validatePayRate(accountForm.payRate) : null
    const validationError = nameError ?? emailError ?? payRateError
    if (validationError) {
      setToast({ message: validationError, title: "Add members", tone: "error" })
      return
    }

    setIsSubmitting(true)
    try {
      const check = await validateEmailsForAddMembers([email])
      if (!check.allOk) {
        const r = check.results[0]
        setToast({
          message: r?.message || "This email cannot be used for a new account yet.",
          title: "Add members",
          tone: "error",
        })
        return
      }
      const rows = [{ name, email, payRate: accountForm.payRate.trim(), currency: accountForm.currency }]
      const payload: AddMembersSubmission = {
        mode: "accounts",
        rows,
        role: accountRole,
        sendWelcomeEmail,
      }
      onPending?.(payload)
      handleClose()
      void onAdd(payload)
        .then((result) => onSuccess?.(result))
        .catch((e) =>
          onError?.(e instanceof Error ? e.message : "Could not create account."),
        )
    } catch (e) {
      setToast({
        message: e instanceof Error ? e.message : "Email check failed.",
        title: "Add members",
        tone: "error",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  let tabDirection = 0
  if (mode !== prevModeRef.current) {
    tabDirection = mode === "accounts" ? 1 : -1
    prevModeRef.current = mode
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={modalTransition}
      className={cn(
        "fixed inset-0 z-70 flex items-start justify-center overflow-y-auto bg-black/50 p-6 pt-[8vh]",
        isClosing && "pointer-events-none",
      )}
      onClick={handleClose}
    >
      <NotifyToastHost
        message={toast?.message ?? null}
        onDismiss={dismissToast}
        title={toast?.title ?? "Add members"}
        tone={toast?.tone ?? "error"}
      />
      <motion.div
        initial={reduceMotion ? false : { scale: 0.97, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={reduceMotion ? undefined : { scale: 0.97, y: 10, opacity: 0 }}
        transition={modalTransition}
        className="flex max-h-[80vh] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Add members</h2>
          <button onClick={handleClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" type="button">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="shrink-0 px-6 pb-2.5 pt-3">
          <div className="relative inline-flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {(
              [
                { id: "invites" as const, label: "Send invites" },
                { id: "accounts" as const, label: "Create account" },
                ...(canMigrate ? [{ id: "migrate" as const, label: "Migrate" }] : []),
              ] as const
            ).map((tab) => {
              const active = mode === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMode(tab.id)}
                  className={cn(
                    "relative z-10 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors",
                    active ? "text-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="add-members-tab-pill"
                      className="absolute inset-0 rounded-lg bg-white dark:bg-slate-700 shadow-sm"
                      transition={paneTransition}
                    />
                  ) : null}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <motion.div
          layout={!reduceMotion}
          transition={paneTransition}
          className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden"
        >
          <AnimatePresence initial={false} custom={tabDirection} mode="popLayout">
            <motion.div
              key={mode}
              custom={tabDirection}
              className="col-start-1 row-start-1 min-h-0 overflow-y-auto px-5 py-3.5 [&::-webkit-scrollbar]:hidden"
              style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
              initial={
                (reduceMotion
                  ? false
                  : (dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? TAB_SLIDE_PX : -TAB_SLIDE_PX,
                    })) as any
              }
              animate={{ opacity: 1, x: 0 }}
              exit={
                (reduceMotion
                  ? undefined
                  : (dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? -TAB_SLIDE_PX : TAB_SLIDE_PX,
                    })) as any
              }
              transition={paneTransition}
            >
              {mode === "invites" ? (
                <InviteForm
                  inviteRows={inviteRows}
                  role={inviteRole}
                  roleOptions={assignableRoles}
                  onAddRow={addInviteRow}
                  onRemoveRow={removeInviteRow}
                  onUpdateRow={updateInviteRow}
                  onRoleChange={setInviteRole}
                />
              ) : mode === "accounts" ? (
                <AccountForm
                  form={accountForm}
                  role={accountRole}
                  roleOptions={assignableRoles}
                  sendWelcomeEmail={sendWelcomeEmail}
                  onUpdateField={updateAccountField}
                  onRoleChange={setAccountRole}
                  onToggleWelcomeEmail={() => setSendWelcomeEmail((v) => !v)}
                />
              ) : (
                <MigrateForm
                  users={migratableUsers}
                  selectedUids={migrateSelectedUids}
                  onToggle={toggleMigrateUid}
                  onToggleMany={toggleMigrateUids}
                  filterText={migrateFilterText}
                  onFilterChange={setMigrateFilterText}
                  resolveRole={resolveMigrateRole}
                  isLoading={migrateLoading}
                  hasMore={Boolean(migrateNextPageToken)}
                  onLoadMore={loadMoreMigratable}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-4">
          <div className="min-h-8 min-w-38">
            <AnimatePresence initial={false}>
              {mode === "invites" ? (
                <motion.button
                  key="share-link"
                  type="button"
                  initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, x: -8 }}
                  transition={paneTransition}
                  onClick={() => void handleShareInviteLink()}
                  disabled={!onShareLink || shareLinkBusy || isSubmitting}
                  className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500 transition-colors hover:text-slate-600 dark:hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {shareLinkBusy ? "Creating link…" : "Share invite link"}
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors" type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSend()}
              disabled={isSubmitting}
              className="px-5 py-2 bg-blue-500 dark:bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 dark:hover:bg-emerald-500 transition-colors disabled:opacity-50" type="button"
            >
              {isSubmitting
                ? "Checking…"
                : mode === "invites"
                  ? "Send invites"
                  : mode === "accounts"
                    ? "Create account"
                    : "Migrate"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
