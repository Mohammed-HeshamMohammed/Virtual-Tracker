import Link from "next/link"
import { redirect } from "next/navigation"
import PageShell from "../../components/PageShell"
import { getDashboardUrl } from "@/lib/site-urls"
import { isValidRedirectUrl } from "@/lib/safe"

export default function SignInPage() {
  const dashboardUrl = getDashboardUrl()
  if (dashboardUrl && isValidRedirectUrl(dashboardUrl)) {
    redirect(dashboardUrl)
  }

  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-20 lg:px-8">
          <span className="inline-flex w-fit rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
            Sign in
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Access your Virtual Tracker workspace</h1>
          <p className="mt-4 text-lg text-slate-600">
            The dashboard app runs separately from this marketing site. Start a demo tour here, or contact us to get workspace access.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/demo"
              className="rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Try the demo
            </Link>
            <Link
              href="/contact"
              className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 hover:border-slate-400"
            >
              Contact sales
            </Link>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
