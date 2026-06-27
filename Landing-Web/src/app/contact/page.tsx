import PageShell from "../../components/PageShell"

export default function ContactPage() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div className="space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Contact sales
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Talk to a product specialist about your team’s workflow.</h1>
            <p className="text-lg text-slate-600">Tell us about your goals and we’ll help you design the right implementation plan.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Book a guided walkthrough</h2>
            <p className="mt-3 text-sm text-slate-600">We’ll show you how Virtual Tracker supports staffing, project delivery, payroll, and executive reporting.</p>
            <div className="mt-6 space-y-3 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-white p-4">Email: hello@virtualtracker.com</div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">Phone: +1 (800) 555-0199</div>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
