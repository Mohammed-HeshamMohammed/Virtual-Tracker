import PageShell from "../../components/PageShell"
import { FEATURE_GROUPS, PRODUCT_DESCRIPTION } from "@/lib/product-content"

export default function FeaturesPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Features overview
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              What the trial client ships today
            </h1>
            <p className="text-lg text-slate-600">{PRODUCT_DESCRIPTION}</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">{group.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{group.description}</p>
                <ul className="mt-5 space-y-2 text-sm text-slate-700">
                  {group.points.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
            <strong className="font-semibold">Roadmap areas (UI present, not fully live):</strong> command center dashboard, reports hub, financials, settings integrations, and timesheet approvals UI. Backend APIs exist for several of these but are gated in the app.
          </div>
        </section>
      </main>
    </PageShell>
  )
}
