"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <main className="flex min-h-screen items-center justify-center px-6 py-20">
          <div className="max-w-xl text-center">
            <h1 className="text-3xl font-semibold">Virtual Tracker</h1>
            <p className="mt-4 text-slate-600">Something went wrong loading this page.</p>
            <button
              type="button"
              onClick={reset}
              className="mt-8 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
