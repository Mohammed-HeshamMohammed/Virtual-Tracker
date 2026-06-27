import PageShell from "../../components/PageShell"
import { PRODUCT_TAGLINE } from "@/lib/product-content"

export default function AboutPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              About Virtual Tracker
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{PRODUCT_TAGLINE}</h1>
            <p className="text-lg text-slate-600">
              Virtual Tracker is a Firebase-backed trial client for time tracking, workforce management, activity capture, project and task management, org hierarchy, and reporting.
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold">Architecture</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                A Next.js dashboard talks to a Node.js API on port 5712. Firestore holds domain data; Firebase RTDB carries ephemeral presence. A Python desktop agent ingests activity while the web timer runs.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold">What we optimize for</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Backend-enforced permissions, hierarchy-aware visibility, and accountable activity capture — without claiming payroll, payments, or third-party integrations that are not implemented yet.
              </p>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
