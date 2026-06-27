"use client"

const FEATURES = [
  {
    tag: "TIME TRACKING INSIGHTS",
    title: "Master time management",
    body: "Connect employee time data with live insights, reporting, and costs so teams can act on what they see in real time.",
    points: ["Real-time productivity metrics", "Detect unusual activity", "Automatic timesheets"],
    cta: "Explore time tracking",
    stat: "44:27", statLabel: "Time tracked",
  },
  {
    tag: "REPORTING & OPERATIONAL VISIBILITY",
    title: "Automate team operations",
    body: "Virtual Tracker automatically tracks billable hours to reduce manual work around timesheets, payroll, and invoicing.",
    points: ["Advanced reporting", "Easy-to-use dashboards", "20+ customizable reports"],
    cta: "View time reports",
    stat: "63%", statLabel: "Activity rate",
  },
  {
    tag: "TIME-DRIVEN COST CONTROL",
    title: "Find and fix money leaks",
    body: "See where billable hours leak with time reports and customizable dashboards. Real-time widgets provide data on project spend, hours worked, and PTO.",
    points: ["Get your priorities straight", "Control expenses", "Project cost tracking"],
    cta: "Project cost tracking",
    stat: "$5,592", statLabel: "Total amount",
  },
  {
    tag: "SMART TIME APPROVALS",
    title: "Time tracking that simplifies payroll",
    body: "Stop relying on manual timesheets. Virtual Tracker converts tracked time into intuitive online timesheets that streamline approvals and accelerate payroll.",
    points: ["Automatic timesheets", "Versatile payroll", "Multi-provider payments"],
    cta: "Intuitive timesheets",
    stat: "228:23", statLabel: "Hours logged",
  },
]

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

function CheckCircle({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function FeaturesSection({ activeFeature, setActiveFeature }: { activeFeature: number; setActiveFeature: (i: number) => void }) {
  return (
    <Section className="py-20">
      <div className="text-center mb-4">
        <span className="text-[#7c3aed] text-xs font-bold uppercase tracking-widest">Better team and time management starts with</span>
      </div>
      <h2 className="text-3xl md:text-5xl font-extrabold text-[#0f172a] text-center mb-4">
        Tangible time tracking data<br />for more profitable decisions
      </h2>
      <p className="text-slate-500 text-center max-w-xl mx-auto mb-14 leading-relaxed">
        Time tracking is more useful when it provides clarity. Connect employee time data with live insights, reporting, and costs so teams can act on what they see in real time.
      </p>

      <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-2">
          {FEATURES.map((f, i) => {
            const open = activeFeature === i
            return (
              <div
                key={f.title}
                className={`rounded-2xl border transition-all duration-200 cursor-pointer ${open ? "border-slate-200 bg-white shadow-lg shadow-slate-100" : "border-transparent bg-slate-50 hover:bg-slate-100"}`}
                onClick={() => setActiveFeature(i)}
              >
                <div className="flex items-start justify-between p-5">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#7c3aed] mb-1">{f.tag}</div>
                    <div className="text-base font-bold text-[#0f172a]">{f.title}</div>
                    {open && (
                      <div className="mt-3 space-y-3">
                        <p className="text-sm text-slate-500 leading-relaxed">{f.body}</p>
                        <ul className="space-y-1.5">
                          {f.points.map(p => (
                            <li key={p} className="flex items-center gap-2 text-sm text-slate-700">
                              <CheckCircle className="w-4 h-4 text-[#7c3aed] flex-shrink-0" />
                              {p}
                            </li>
                          ))}
                        </ul>
                        <button className="flex items-center gap-1.5 text-sm font-semibold text-[#7c3aed] hover:gap-2.5 transition-all">
                          {f.cta} <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-4 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="w-full md:w-72 lg:w-80 flex-shrink-0 sticky top-24">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 shadow-xl">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              {FEATURES[activeFeature].tag}
            </div>
            <div className="text-white font-bold mb-4 text-sm">{FEATURES[activeFeature].title}</div>
            <div className="space-y-2">
              {FEATURES[activeFeature].points.map(p => (
                <div key={p} className="flex items-center gap-2.5 bg-white/5 rounded-lg px-3 py-2.5">
                  <div className="w-5 h-5 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <span className="text-xs text-slate-300">{p}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 h-24 bg-white/5 rounded-xl flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-black text-white tabular-nums">{FEATURES[activeFeature].stat}</div>
                <div className="text-[10px] text-slate-400 mt-1">{FEATURES[activeFeature].statLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-4 mt-14">
        <button className="px-6 py-3 rounded-full font-bold text-sm text-white shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 transition-shadow" style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}>
          Start free 14-day trial
        </button>
        <button className="px-6 py-3 rounded-full font-semibold text-sm text-[#374151] hover:text-[#0f172a] flex items-center gap-1.5">
          See all features <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </Section>
  )
}
