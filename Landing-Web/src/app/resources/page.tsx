import PageShell from "../../components/PageShell"

export default function ResourcesPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Resources
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Documentation and guides</h1>
            <p className="text-lg text-slate-600">
              Engineering and domain documentation lives in the repository under <code className="text-sm bg-slate-100 px-1 rounded">app/docs/</code>.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {[
              { title: "Project Hierarchy", desc: "Code map for backend modules, frontend features, and routing." },
              { title: "Member Hierarchy and Role Visibility", desc: "Org tree, roles, and who can see what." },
              { title: "Authentication and Email Verification", desc: "Sign-in UX, verification gate, and hosting handler." },
              { title: "Python agent Readme", desc: "Desktop agent setup for Windows and macOS." },
            ].map((resource) => (
              <div key={resource.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <h2 className="text-xl font-semibold">{resource.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{resource.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  )
}
