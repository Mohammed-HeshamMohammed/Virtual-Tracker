"use client"

import Link from "next/link"

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-20 text-slate-900">
      <div className="max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-600">Something went wrong</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">We hit an unexpected error</h1>
        <p className="mt-6 text-lg text-slate-600">
          The page did not load completely, but you can try again or return to the homepage.
        </p>
        {process.env.NODE_ENV !== "production" && error.message ? (
          <p className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-left text-xs text-slate-600">{error.message}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <Link href="/" className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700">
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
