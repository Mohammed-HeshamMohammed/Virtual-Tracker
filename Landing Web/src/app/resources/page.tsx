import PageShell from "../../components/PageShell"

const resources = [
  {
    title: "Time tracking guide",
    description: "Learn how to structure time capture for client work, field teams, and internal operations.",
  },
  {
    title: "ROI calculator",
    description: "Estimate how much time and money your organization could recover with better tracking.",
  },
  {
    title: "Customer stories",
    description: "See how operations leaders use Virtual Tracker to improve project delivery and visibility.",
  },
]

export default function ResourcesPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Resources hub
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Helpful content for leaders planning their next move.</h1>
            <p className="text-lg text-slate-600">Browse practical guides and examples to build confidence before rollout.</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {resources.map((resource) => (
              <div key={resource.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <h2 className="text-xl font-semibold">{resource.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{resource.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  )
}
