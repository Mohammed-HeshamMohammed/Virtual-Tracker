"use client"

import { useEffect, useState } from "react"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { changePasswordWithReauth } from "@/lib/auth/change-password"
import { isEmailPasswordAccount } from "@/lib/auth/email-verification"
import { isNotificationsBellEnabled, setNotificationsBellEnabled } from "@/lib/notify-prefs"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
const labelClass = "text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono"

export default function SettingsPage() {
  const { user } = useCurrentUser()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [notifyEnabled, setNotifyEnabled] = useState(true)

  useEffect(() => {
    setNotifyEnabled(isNotificationsBellEnabled())
  }, [])

  function toggleNotify() {
    const next = !notifyEnabled
    setNotifyEnabled(next)
    setNotificationsBellEnabled(next)
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !user) return
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await changePasswordWithReauth(user, currentPassword, newPassword)
    if (result.ok) {
      setSaved(true)
      setCurrentPassword("")
      setNewPassword("")
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  const canChangePassword = isEmailPasswordAccount(user ?? null)

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Settings</h1>
        <p className="text-xs text-slate-500 mb-6">Preferences for your Virtual Tracker account on this site.</p>

        <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <div>
            <p className="text-sm font-semibold text-slate-800">Notification bell</p>
            <p className="text-xs text-slate-500 mt-0.5">Show the notifications icon next to your avatar.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notifyEnabled}
            onClick={toggleNotify}
            className={`relative h-6 w-11 rounded-full transition-colors ${notifyEnabled ? "bg-violet-600" : "bg-slate-300"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                notifyEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {canChangePassword && (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Change password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <label className={labelClass}>Current password</label>
              <input
                type="password"
                className={inputClass}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>New password</label>
              <input
                type="password"
                className={inputClass}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <p className="text-xs font-semibold text-red-600" role="alert">
                {error}
              </p>
            )}
            {saved && <p className="text-xs font-semibold text-emerald-600">Password updated.</p>}

            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-violet-600 px-6 py-3 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
