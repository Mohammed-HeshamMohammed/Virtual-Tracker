"use client"

import { useState } from "react"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { patchProfileSettingsWithBackend } from "@/lib/auth/profile-api"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
const labelClass = "text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono"

export default function ProfilePage() {
  const { user, profile } = useCurrentUser()
  const [firstName, setFirstName] = useState(profile?.firstName ?? "")
  const [lastName, setLastName] = useState(profile?.lastName ?? "")
  const [phone, setPhone] = useState(profile?.phone ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await patchProfileSettingsWithBackend({ firstName, lastName, ...(phone ? { phone } : {}) })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-sm space-y-6">
      <div className="flex items-center gap-4">
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-lg font-bold text-violet-700">
            {(firstName || user?.displayName || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-900">Profile</h1>
          <p className="text-xs text-slate-500">{profile?.primaryEmail ?? user?.email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className={labelClass}>First name</label>
            <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Last name</label>
            <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <label className={labelClass}>Phone</label>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        {error && (
          <p className="text-xs font-semibold text-red-600" role="alert">
            {error}
          </p>
        )}
        {saved && <p className="text-xs font-semibold text-emerald-600">Profile updated.</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-violet-600 px-6 py-3 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      </form>
    </div>
  )
}
