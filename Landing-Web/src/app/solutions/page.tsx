import PageShell from "../../components/PageShell"
import { SOLUTIONS } from "@/lib/product-content"

export default function SolutionsPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Use cases
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Where Virtual Tracker fits</h1>
            <p className="text-lg text-slate-600">
              The trial client targets teams that need task-linked time tracking, desktop activity capture, and org hierarchy on Firebase — not payroll or third-party sync yet.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {SOLUTIONS.map((solution) => (
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
