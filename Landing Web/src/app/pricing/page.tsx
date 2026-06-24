import PageShell from "../../components/PageShell"

const plans = [
  {
    name: "Starter",
    price: "$9",
    description: "For lean teams and fast-moving freelancers.",
    features: ["Unlimited projects", "Basic timesheets", "Weekly reports"],
  },
  {
    name: "Growth",
    price: "$19",
    description: "For scaling teams that need deeper visibility.",
    features: ["Advanced dashboards", "Approval workflows", "Project budgets"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For global organizations with security and compliance needs.",
    features: ["SSO and audit logs", "Custom integrations", "Dedicated onboarding"],
  },
]

export default function PricingPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Flexible pricing
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Choose a plan that matches your team’s pace.</h1>
            <p className="text-lg text-slate-600">Switch plans as your operations become more complex, without losing visibility.</p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.name} className="rounded-2xl border border-slate-200 p-8 shadow-sm">
                <h2 className="text-2xl font-semibold">{plan.name}</h2>
                <p className="mt-3 text-sm text-slate-600">{plan.description}</p>
                <div className="mt-6 text-4xl font-semibold text-slate-900">{plan.price}</div>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  {plan.features.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                      {item}
                    </li>
                  ))}
                </ul>
                <button className="mt-8 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                  Start free trial
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  )
}
