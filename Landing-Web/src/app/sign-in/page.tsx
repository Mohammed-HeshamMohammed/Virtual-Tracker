"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import PageShell from "../../components/PageShell"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { signInWithEmailPassword, signInWithGoogle } from "@/lib/auth/sign-in"
import { registerWithEmailPassword } from "@/lib/auth/sign-up"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
const labelClass = "text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono"

export default function SignInPage() {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registered, setRegistered] = useState(false)

  if (!userLoading && user) {
    router.replace("/account/reports")
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === "register") {
        await registerWithEmailPassword(email, password, { firstName, lastName, rememberMe })
        setRegistered(true)
        setMode("sign-in")
      } else {
        await signInWithEmailPassword(email, password, rememberMe)
        router.replace("/account/reports")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle(rememberMe)
      router.replace("/account/reports")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 min-h-[85vh] flex items-center justify-center py-16 px-4">
        <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-200/20 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-lg z-10 space-y-6">
          <div className="text-center space-y-2">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1 text-xs font-bold text-violet-700 uppercase tracking-wider">
              Virtual Tracker
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-3xl">
              {mode === "register" ? "Create your account" : "Welcome back"}
            </h1>
          </div>

          {registered && (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
              Account created. Check your inbox for a verification link, then sign in below.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className={labelClass}>First name</label>
                  <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Last name</label>
                  <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>
            )}

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

            <div className="space-y-2">
              <label className={labelClass}>Password</label>
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-500 font-medium">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 text-violet-600 focus:ring-violet-200"
                />
                Remember me
              </label>
              {mode === "sign-in" && (
                <a href="/reset-password" className="font-semibold text-violet-600 hover:text-violet-800">
                  Forgot password?
                </a>
              )}
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
              {busy ? "Please wait..." : mode === "register" ? "Create account" : "Sign in"}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">or</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="w-full inline-flex justify-center items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.85-.08-1.66-.22-2.45H12v4.64h6.46c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1C3.25 21.3 7.31 24 12 24z" />
              <path fill="#FBBC05" d="M5.29 14.31A7.2 7.2 0 014.9 12c0-.8.14-1.58.38-2.31v-3.1H1.28A11.98 11.98 0 000 12c0 1.94.46 3.77 1.28 5.41z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.28 6.59l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z" />
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-xs text-slate-500">
            {mode === "register" ? (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => setMode("sign-in")} className="font-semibold text-violet-600 hover:text-violet-800">
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Virtual Tracker?{" "}
                <button type="button" onClick={() => setMode("register")} className="font-semibold text-violet-600 hover:text-violet-800">
                  Create an account
                </button>
              </>
            )}
          </p>
        </div>
      </main>
    </PageShell>
  )
}
