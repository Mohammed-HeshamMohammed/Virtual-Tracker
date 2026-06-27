import Link from "next/link"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-20 text-slate-900">
      <div className="max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-600">404</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Page not found</h1>
        <p className="mt-6 text-lg text-slate-600">The page you requested doesn’t exist yet, but you can return to the homepage or explore the main sections.</p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/" className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Go home</Link>
          <Link href="/contact" className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700">Contact us</Link>
        </div>
      </div>
    </main>
  )
}
