import PageShell from "../../components/PageShell"

export default function DemoPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Product walkthrough
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Explore the live trial client</h1>
            <p className="text-lg text-slate-600">
              Sign in to the dashboard to use the workspaces that ship today: people, projects & tasks, activity feeds, and timesheets.
            </p>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Available workspaces</h2>
            <ul className="mt-6 grid gap-4 text-sm text-slate-700 md:grid-cols-2">
              <li className="rounded-xl border border-slate-200 bg-white p-4">People — members, invites, hierarchy tree, teams, bans</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Project management — clients, projects, tasks, overview</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Activity — screenshots, apps, URLs (with desktop agent)</li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">Timesheets — view & edit time entries</li>
            </ul>
            <p className="mt-6 text-sm text-slate-500">
              Reports, financials, command center, and settings integrations are on the roadmap and currently show as coming soon in the app.
            </p>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
