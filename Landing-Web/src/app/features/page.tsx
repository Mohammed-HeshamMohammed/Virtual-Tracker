import PageShell from "../../components/PageShell"

const featureGroups = [
  {
    title: "Time tracking that feels effortless",
    description: "Capture work from desktop, mobile, and field devices without slowing your team down.",
    points: ["Automatic reminders", "Project and task-level tracking", "One-click timesheets"],
  },
  {
    title: "Visibility for every manager",
    description: "Give leaders dashboards that show focus, availability, and output in real time.",
    points: ["Live activity feeds", "Workload balancing", "Proof-of-work snapshots"],
  },
  {
    title: "Operations that scale",
    description: "Handle remote, hybrid, and field operations with the same control plane.",
    points: ["Flexible approval flows", "Role-based permissions", "Custom reporting"],
  },
]

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
              Built for teams that need clarity without friction.
            </h1>
            <p className="text-lg text-slate-600">
              Virtual Tracker brings together time capture, productivity insight, and billing workflows in a single experience.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {featureGroups.map((group) => (
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
        </section>
      </main>
    </PageShell>
  )
}
