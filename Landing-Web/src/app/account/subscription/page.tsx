const PLANS = [
  {
    name: "Trial",
    price: "Free",
    period: "for 30 days",
    features: ["Time tracking & activity monitoring", "Projects, tasks, & clients CRUD", "Org hierarchy & invite flows"],
  },
  {
    name: "Team",
    price: "$15",
    period: "per user / month",
    features: ["Role-based visibility scopes", "Unlimited members & workspaces", "Presence & WebSocket monitoring"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "tailored deployment",
    features: ["Custom on-prem onboarding", "Security reviews support", "Dedicated SLA metrics"],
  },
]

/** Static plans reference — no billing/entitlement backend exists yet. */
export default function SubscriptionPage() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Subscription</h1>
        <p className="text-xs text-slate-500 mt-1">
          Your current plan:{" "}
          <span className="rounded-full bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">
            Free Trial
          </span>
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <div key={plan.name} className="rounded-2xl border border-slate-200/80 p-6 flex flex-col justify-between">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">{plan.name}</h2>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-slate-900">{plan.price}</span>
                <span className="text-[11px] font-light text-slate-400">/{plan.period}</span>
              </div>
              <ul className="mt-4 space-y-2 text-xs text-slate-600 font-light">
                {plan.features.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <a href="/contact" className="inline-block text-xs font-semibold text-violet-600 hover:text-violet-800">
        Contact us to change your plan &rarr;
      </a>
    </div>
  )
}
