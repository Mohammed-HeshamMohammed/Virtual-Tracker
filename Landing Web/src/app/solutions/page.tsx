import PageShell from "../../components/PageShell"

const solutions = [
  {
    title: "Agencies",
    description: "Run client work, track billable hours, and invoice faster with one connected workspace.",
  },
  {
    title: "Field teams",
    description: "Capture attendance, geofenced check-ins, and project updates from the field.",
  },
  {
    title: "Remote teams",
    description: "Create shared accountability across distributed teams with clear work visibility.",
  },
  {
    title: "Enterprises",
    description: "Support multi-location operations with governance, compliance, and reporting at scale.",
  },
]

export default function SolutionsPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Solutions by use case
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">A single platform for modern work operations.</h1>
            <p className="text-lg text-slate-600">Whether you run a creative studio, an outsourced operation, or a global service business, Virtual Tracker adapts to your workflow.</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {solutions.map((solution) => (
              <div key={solution.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <h2 className="text-xl font-semibold">{solution.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{solution.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  )
}
