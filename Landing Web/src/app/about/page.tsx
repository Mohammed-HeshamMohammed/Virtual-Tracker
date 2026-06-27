import PageShell from "../../components/PageShell"

export default function AboutPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              About Virtual Tracker
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Helping teams track work with trust and transparency.</h1>
            <p className="text-lg text-slate-600">We built Virtual Tracker to make operational visibility simple for the teams that keep the world moving.</p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold">Why we exist</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">Many tools focus on tracking activity but miss the human side of productivity. Virtual Tracker balances accountability with respect for the way real work happens.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold">What makes us different</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">From mobile check-ins to finance-ready reporting, every feature is designed to reduce friction for managers, operators, and employees.</p>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
