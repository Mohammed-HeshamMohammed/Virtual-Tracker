"use client"

import { useState } from "react"
import { UserPlus, X } from "lucide-react"
import { createMemberTransferRequest } from "@/features/members/services/member-transfer-requests"
import { validateEmailField } from "@/shared/validation"

interface RecruitMemberModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: (result: { transferUrl: string; email: string }) => void
}

export function RecruitMemberModal({ open, onClose, onSuccess }: RecruitMemberModalProps) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transferUrl, setTransferUrl] = useState<string | null>(null)

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const validationError = validateEmailField(email, { label: "Email" })
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    try {
      const result = await createMemberTransferRequest(email.trim())
      setTransferUrl(result.transfer_url)
      onSuccess?.({ transferUrl: result.transfer_url, email: email.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invitation.")
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    setEmail("")
    setError(null)
    setTransferUrl(null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4"
      aria-label="Request member transfer"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <UserPlus className="h-5 w-5" />
            Recruit member
          </div>
          <button type="button" onClick={handleClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Invite an existing Viewer or unassigned user to join your team. They will receive an email and in-app notification.
        </p>

        {transferUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Invitation sent successfully.</p>
            <label className="block text-xs font-medium text-slate-500">Shareable link</label>
            <input
              readOnly
              value={transferUrl}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" onClick={handleClose} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="recruit-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Member email
              </label>
              <input
                id="recruit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="mohamed@example.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={busy}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={handleClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700" disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900" disabled={busy}>
                {busy ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
