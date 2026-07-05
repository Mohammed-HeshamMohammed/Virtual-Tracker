"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import { sendFirebasePasswordResetEmail, PASSWORD_RESET_SUCCESS_MESSAGE } from "@/lib/auth/password-reset"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
const labelClass = "text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono"

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await sendFirebasePasswordResetEmail(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 min-h-[85vh] flex items-center justify-center py-16 px-4">
        <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1 text-xs font-bold text-violet-700 uppercase tracking-wider">
              Virtual Tracker
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-3xl">Reset your password</h1>
          </div>

          {sent ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
              {PASSWORD_RESET_SUCCESS_MESSAGE}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              {error && (
                <p className="text-xs font-semibold text-red-600" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex justify-center items-center rounded-full bg-violet-600 px-6 py-3.5 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-slate-500">
            <a href="/sign-in" className="font-semibold text-violet-600 hover:text-violet-800">
              Back to sign in
            </a>
          </p>
        </div>
      </main>
    </PageShell>
  )
}
