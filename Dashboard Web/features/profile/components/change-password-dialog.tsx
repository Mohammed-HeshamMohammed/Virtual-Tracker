"use client"

import { useState } from "react"
import { cn } from "@/shared/utils/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { changePasswordWithReauth } from "@/features/auth/services/change-password"
import { usePasswordPolicy } from "@/features/auth"
import type { User } from "firebase/auth"

type ChangePasswordDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
  isDark: boolean
}

export function ChangePasswordDialog({ open, onOpenChange, user, isDark }: ChangePasswordDialogProps) {
  const { policy: passwordPolicy } = usePasswordPolicy()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)

  function resetForm() {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setMessage(null)
    setBusy(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setMessage(null)
    const result = await changePasswordWithReauth(
      user,
      currentPassword,
      newPassword,
      confirmPassword,
      passwordPolicy.passwordPolicy,
    )
    if (!result.ok) {
      setMessage({ type: "error", text: result.error })
      setBusy(false)
      return
    }
    setMessage({ type: "success", text: "Password updated successfully." })
    setBusy(false)
    setTimeout(() => handleOpenChange(false), 1200)
  }

  const inputCls = cn(
    "w-full rounded-lg border px-3 py-2.5 text-sm transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400",
    isDark ? "border-white/10 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-700",
  )

  const labelCls = cn(
    "mb-1.5 block text-[10px] font-bold uppercase tracking-wider",
    isDark ? "text-[#bccbb9]" : "text-slate-400",
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("sm:max-w-md", isDark ? "border-white/10 bg-[#191f31] text-[#dce1fb]" : "")}>
        <DialogHeader>
          <DialogTitle className={isDark ? "text-[#dce1fb]" : undefined}>Change password</DialogTitle>
          <DialogDescription className={isDark ? "text-[#bccbb9]" : undefined}>
            Enter your current password, then choose a new one. You will stay signed in after a successful change.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="profile-current-password">
              Current password
            </label>
            <input
              id="profile-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="profile-new-password">
              New password
            </label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="profile-confirm-new-password">
              Confirm new password
            </label>
            <input
              id="profile-confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={inputCls}
            />
          </div>

          {message ? (
            <p
              role={message.type === "error" ? "alert" : "status"}
              className={cn(
                "text-sm",
                message.type === "error"
                  ? isDark
                    ? "text-red-400"
                    : "text-red-600"
                  : isDark
                    ? "text-[#4be277]"
                    : "text-emerald-600",
              )}
            >
              {message.text}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium",
                isDark ? "border-white/10 text-[#dce1fb] hover:bg-white/5" : "border-slate-200 text-slate-700 hover:bg-slate-50",
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !user}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
