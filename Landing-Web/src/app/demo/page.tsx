import PageShell from "../../components/PageShell"

export default function DemoPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Live demo
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">See how Virtual Tracker works in a guided product tour.</h1>
            <p className="text-lg text-slate-600">Walk through dashboard views, approvals, reports, and payroll automation with our team.</p>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
            <h2 className="text-xl font-semibold">What you’ll see</h2>
            <ul className="mt-6 grid gap-4 text-sm text-slate-700 md:grid-cols-2">
              <li className="rounded-xl border border-slate-200 bg-white p-4">Timesheet creation and approval</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Live operations dashboards</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Budget and invoicing workflows</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Reporting and team insights</li>
            </ul>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
