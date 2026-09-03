"use client"

import { useState } from "react"
import type { User } from "firebase/auth"
import { cn } from "@/shared/utils/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import {
  deleteViewerAccountWithBackend,
  reauthenticateEmailPasswordUser,
  submitAccountDeactivationRequest,
} from "@/features/auth/api/account-deactivation-api"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"

type AccountActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "delete" | "request"
  user: User | null
  isEmailPasswordUser: boolean
  isDark: boolean
  onDeleted?: () => void
}

export function AccountActionDialog({
  open,
  onOpenChange,
  mode,
  user,
  isEmailPasswordUser,
  isDark,
  onDeleted,
}: AccountActionDialogProps) {
  const [password, setPassword] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const isDelete = mode === "delete"
  const confirmPhrase = isDelete ? "DELETE" : "DEACTIVATE"
  const canSubmitDelete =
    isDelete &&
    confirmText.trim().toUpperCase() === confirmPhrase &&
    (!isEmailPasswordUser || password.trim().length > 0)
  const canSubmitRequest = !isDelete && confirmText.trim().toUpperCase() === confirmPhrase

  function resetState() {
    setPassword("")
    setConfirmText("")
    setError(null)
    setSuccessMessage(null)
    setBusy(false)
  }

  function handleOpenChange(next: boolean) {
    if (busy) return
    if (!next) resetState()
    onOpenChange(next)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)
    setSuccessMessage(null)
    setBusy(true)
    try {
      if (isDelete) {
        if (isEmailPasswordUser) {
          await reauthenticateEmailPasswordUser(user, password)
        }
        await deleteViewerAccountWithBackend()
        resetState()
        onOpenChange(false)
        onDeleted?.()
        return
      }
      const result = await submitAccountDeactivationRequest()
      setSuccessMessage(
        result.alreadyPending
          ? "A deactivation request is already pending review by an Admin, Super Admin, or Owner."
          : "Your deactivation request has been submitted. An Admin, Super Admin, or Owner will review it.",
      )
      setConfirmText("")
      setPassword("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  const inputCls = cn(
    "w-full rounded-lg border px-3 py-2 text-sm",
    isDark ? "border-white/10 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-900",
  )

  const labelCls = cn(
    "mb-1 block text-xs font-semibold uppercase tracking-wide",
    isDark ? "text-slate-500" : "text-slate-500",
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn("sm:max-w-md", isDark ? "border-slate-600/80 bg-[#101417] text-slate-100" : "")}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className={isDark ? "text-[#dce1fb]" : undefined}>
            {isDelete ? "Delete account" : "Request account deactivation"}
          </DialogTitle>
          <DialogDescription className={isDark ? "text-[#bccbb9]" : undefined}>
            {isDelete
              ? "This permanently deletes your Firebase account, profile, and member records. This cannot be undone."
              : "Your account stays active until an Admin, Super Admin, or Owner approves the deactivation request."}
          </DialogDescription>
        </DialogHeader>

        {successMessage ? (
          <>
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>
            <DialogFooter>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 sm:w-auto"
              >
                Close
              </button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {isDelete && isEmailPasswordUser ? (
              <div>
                <label className={labelCls}>Current password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className={inputCls}
                />
              </div>
            ) : null}

            <div>
              <label className={labelCls}>Type {confirmPhrase} to confirm</label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className={inputCls}
              />
            </div>

            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleOpenChange(false)}
                className={cn(
                  "rounded-lg border px-4 py-2.5 text-sm font-semibold disabled:opacity-50",
                  isDark ? "border-white/10 text-[#dce1fb] hover:bg-white/5" : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !(isDelete ? canSubmitDelete : canSubmitRequest)}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Working…" : isDelete ? "Delete account" : "Submit request"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export async function clearLocalSessionAfterAccountDeletion(): Promise<void> {
  try {
    await getFirebaseAuth().signOut()
  } catch {
    /* user may already be deleted server-side */
  }
}
