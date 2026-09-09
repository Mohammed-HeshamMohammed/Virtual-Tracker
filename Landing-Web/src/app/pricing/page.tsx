"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import AppCtaLink from "@/components/AppCtaLink"
import { getTrialHref } from "@/lib/site-urls"

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly")
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const plans = [
    {
      name: "Trial",
      price: "Free",
      period: "for 30 days",
      description: "Full trial client for pilots and internal evaluations.",
      features: ["Time tracking & activity monitoring", "Projects, tasks, & clients CRUD", "Org hierarchy & invite flows", "Desktop agent (Windows & macOS)"],
      cta: "Open dashboard",
      href: getTrialHref(),
      popular: true
    },
    {
      name: "Team",
      price: billingCycle === "monthly" ? "$15" : "$12",
      period: "per user / month",
      description: "For teams deploying Virtual Tracker on their Firebase project.",
      features: ["Role-based visibility scopes", "Unlimited members & workspaces", "Presence & WebSocket monitoring", "API integration options"],
      cta: "Contact sales",
      href: "/contact",
      popular: false
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "tailored layout",
      description: "Multi-workspace configurations or dedicated deployment support.",
      features: ["Custom on-prem onboarding", "Security reviews support", "Priority roadmap alignment", "Dedicated SLA metrics"],
      cta: "Contact sales",
      href: "/contact",
      popular: false
    }
  ]

  const faqs = [
    {
      q: "Are there any licensing costs or hidden fees?",
      a: "No. Virtual Tracker is an open-source evaluation build. You host it on your own Firebase project, paying only your standard Google Cloud platform limits."
    },
    {
      q: "Can I transition my workspace from Trial to Team?",
      a: "Yes. Since all organizational nodes and Firestore collections live inside your database instance, upgrading is as simple as migrating configuration files."
    },
    {
      q: "Does Virtual Tracker handle payroll payouts?",
      a: "Currently, budget caps, timesheets, and pay rates are captured strictly as metadata values to calculate utilization. Actual billing integrations are gated."
    },
    {
      q: "What OS support exists for the tracker agent?",
      a: "The activity-capture desktop agent is a native Python utility compatible with Windows 10/11 and macOS Big Sur or newer."
    }
  ]

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Pricing & Plans"
          title="Evaluation and deployment options"
          description="Virtual Tracker provides modular plans to evaluate the client or integrate it directly into your company's cloud infrastructure."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-20">
          <div className="flex justify-center">
            <div className="relative flex items-center bg-white border border-slate-200 p-1.5 rounded-full shadow-sm">
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`px-6 py-2 text-xs font-bold rounded-full transition-all duration-200 ${
                  billingCycle === "monthly" ? "bg-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Monthly Billing
              </button>
              <button
                onClick={() => setBillingCycle("annual")}
                className={`px-6 py-2 text-xs font-bold rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                  billingCycle === "annual" ? "bg-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Annual Billing
                <span className="text-[9px] font-extrabold uppercase bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                  Save 20%
                </span>
              </button>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-3xl bg-white p-8 shadow-sm transition-all duration-300 hover:shadow-lg flex flex-col justify-between border ${
                  plan.popular ? "border-violet-300 ring-4 ring-violet-50" : "border-slate-200/80"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3.5 left-8 inline-flex items-center rounded-full bg-violet-600 px-3.5 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
                    Most Popular
                  </span>
                )}
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-slate-900">{plan.name}</h2>
                    {plan.popular && <span className="w-2.5 h-2.5 rounded-full bg-violet-600 animate-ping" />}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-slate-500 font-light min-h-[40px]">
                    {plan.description}
                  </p>
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-black tracking-tight text-slate-900">{plan.price}</span>
                    <span className="text-xs font-light text-slate-400">/{plan.period}</span>
                  </div>

                  <div className="border-t border-slate-100 my-6" />

                  <ul className="space-y-4 text-xs text-slate-600 font-light">
                    {plan.features.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5 text-violet-600">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8">
                  <AppCtaLink
                    href={plan.href}
                    className={`w-full inline-flex justify-center items-center rounded-full px-5 py-3.5 text-xs font-bold transition-all duration-300 hover:scale-[1.02] cursor-pointer ${
                      plan.popular
                        ? "bg-violet-600 text-white hover:bg-violet-700 shadow-md shadow-violet-200"
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    }`}
                  >
                    {plan.cta}
                  </AppCtaLink>
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm max-w-4xl mx-auto">
            <h3 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-6 text-center">Frequently Asked Questions</h3>
            <div className="space-y-4">
              {faqs.map((faq, idx) => (
                <div key={idx} className="border-b border-slate-100 pb-4">
                  <button
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full flex items-center justify-between text-left py-2 focus:outline-none"
                  >
                    <span className="text-sm font-bold text-slate-800 hover:text-violet-700 transition-colors duration-200">{faq.q}</span>
                    <span className="ml-4 text-violet-600 flex-shrink-0">
                      {openFaq === idx ? (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v5.25h5.25a.75.75 0 010 1.5h-5.25v5.25a.75.75 0 01-1.5 0v-5.25H3.75a.75.75 0 010-1.5h5.25V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
                        </svg>
                      )}
                    </span>
                  </button>
                  {openFaq === idx && (
                    <p className="mt-3 text-xs leading-relaxed text-slate-500 font-light pr-8 animate-fadeIn">
                      {faq.a}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </PageShell>
  )
}
