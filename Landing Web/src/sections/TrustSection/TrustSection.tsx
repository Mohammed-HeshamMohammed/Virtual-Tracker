"use client"

const TRUST_CARDS = [
  {
    title: "Privacy-first guiding principles",
    body: "Transparency, Access, and Control - how we give autonomy to every member of the team.",
    cta: "View our approach",
  },
  {
    title: "Enterprise-Grade Solutions",
    body: "GDPR, HIPAA, SOC 2 Type II compliance credentials, and more.",
    cta: "Explore our credentials",
  },
  {
    title: "Over 35 integrations",
    body: "Level up your workflows with high-end tools like Salesforce, Jira, Slack, Deel, and PayPal.",
    cta: "See all integrations",
  },
]

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function TrustSection() {
  return (
    <div style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #4c1d95 60%, #6d28d9 100%)" }} className="py-20">
      <Section>
        <div className="text-center mb-4">
          <span className="text-violet-300/70 text-xs font-bold uppercase tracking-widest">Trust through transparency</span>
        </div>
        <h2 className="text-3xl md:text-5xl font-extrabold text-white text-center mb-4">
          Built on transparency, security,<br />and seamless integration
        </h2>
        <p className="text-white/50 text-center max-w-xl mx-auto mb-12 leading-relaxed">
          Designed to give you full visibility, protect your data with enterprise-grade security, and connect effortlessly with the tools you already use.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {TRUST_CARDS.map((c, i) => (
            <div key={c.title} className="rounded-2xl bg-white/8 backdrop-blur-sm border border-white/10 overflow-hidden">
              <div className="h-36 flex items-center justify-center" style={{ background: ["#e8eeff", "#dbeafe", "#ede9fe"][i] }}>
                <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center">
                  {i === 0 && <svg viewBox="0 0 24 24" className="w-7 h-7 text-violet-600" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l3.5 7 7.5 1-5.5 5.3 1.3 7.7L12 20l-6.8 3 1.3-7.7L1 10l7.5-1z" /></svg>}
                  {i === 1 && <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l8 4v6c0 5.5-3.8 10.7-8 12C7.8 22.7 4 17.5 4 12V6l8-4z" /></svg>}
                  {i === 2 && <svg viewBox="0 0 24 24" className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v7M2 12h7M22 12h-7M12 22v-7M5.6 5.6l5 5M18.4 5.6l-5 5M5.6 18.4l5-5M18.4 18.4l-5-5" strokeLinecap="round" /></svg>}
                </div>
              </div>
              <div className="p-5">
                <h3 className="font-bold text-white mb-2">{c.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed mb-4">{c.body}</p>
                <button className="flex items-center gap-1.5 text-sm font-semibold text-violet-300 hover:gap-2.5 transition-all">
                  {c.cta} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
