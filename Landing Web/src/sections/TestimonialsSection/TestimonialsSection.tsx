"use client"

const TESTIMONIALS = [
  {
    company: "OneIMS",
    bg: "#1a2744",
    light: true,
    headline: "25% Cost savings by eliminating wasted tasks",
    stats: [
      { value: "10% - 25%", label: "Project savings" },
      { value: "25%", label: "Cost reduction from bad hires" },
    ],
  },
  {
    company: "Alpha Efficiency",
    bg: "#ffffff",
    light: false,
    quote: "My people need to document their work so that I can have visibility into what they did during the day. Using Virtual Tracker reduces the meeting time I needed and gives me clarity into what was done and what wasn't.",
    author: "Brian Dordevic",
    role: "Director of Strategic Planning",
  },
  {
    company: "MR Digital",
    bg: "#fef3c7",
    light: false,
    headline: "10% Reduction in check-in meeting time",
    stats: [
      { value: "10% - 25%", label: "Increase in activity level" },
      { value: "100%", label: "Confidence in running remote ops" },
    ],
  },
]

const REVIEW_PLATFORMS = [
  { name: "GetApp",   stars: "4.6", count: "1,500" },
  { name: "Capterra", stars: "4.6", count: "1,500" },
  { name: "G2 Crowd", stars: "4.5", count: "1,300" },
]

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

function Star({ filled = true }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 inline" fill={filled ? "#f59e0b" : "none"} stroke="#f59e0b" strokeWidth="1">
      <path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z" />
    </svg>
  )
}

export default function TestimonialsSection() {
  return (
    <div className="py-20 bg-[#f0f4ff]">
      <Section>
        <div className="text-center mb-4">
          <span className="text-[#7c3aed] text-xs font-bold uppercase tracking-widest">Time tracking tools to maximize your team's productivity</span>
        </div>
        <h2 className="text-3xl md:text-5xl font-extrabold text-[#0f172a] text-center mb-12">
          See what our customers say
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto mb-10">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="rounded-2xl p-6 flex flex-col" style={{ backgroundColor: t.bg, minHeight: 280 }}>
              <div className="text-xs font-bold mb-4 text-slate-400">{t.company}</div>
              {"headline" in t && (
                <>
                  <div className={`text-xl font-extrabold leading-snug flex-1 ${t.light ? "text-white" : "text-slate-800"}`}>
                    <span className="text-emerald-400">
                      {(t as { headline: string }).headline.match(/^\d+%/)?.[0]}
                    </span>{" "}
                    {(t as { headline: string }).headline.replace(/^\d+%\s*/, "")}
                  </div>
                  {"stats" in t && (
                    <div className="mt-4 space-y-3">
                      {(t as { stats: { value: string; label: string }[] }).stats.map((s, j) => (
                        <div key={j}>
                          <div className={`text-lg font-extrabold ${t.light ? "text-emerald-400" : "text-[#2563eb]"}`}>{s.value}</div>
                          <div className={`text-xs ${t.light ? "text-slate-400" : "text-slate-500"}`}>{s.label}</div>
                          {j < (t as { stats: { value: string; label: string }[] }).stats.length - 1 && (
                            <div className={`h-px mt-2 ${t.light ? "bg-white/10" : "bg-slate-200"}`} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {"quote" in t && (
                <>
                  <p className="text-slate-600 text-sm leading-relaxed flex-1">{(t as { quote: string }).quote}</p>
                  <div className="mt-4">
                    <div className="font-bold text-sm text-slate-800">{(t as { author: string }).author}</div>
                    <div className="text-xs text-slate-400">{(t as { role: string }).role}</div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-0 max-w-2xl mx-auto border border-slate-200 rounded-2xl bg-white overflow-hidden divide-x divide-slate-200">
          {REVIEW_PLATFORMS.map(p => (
            <div key={p.name} className="flex-1 px-6 py-4 text-center min-w-[140px]">
              <div className="text-sm font-bold text-slate-700 mb-0.5">{p.name}</div>
              <div className="text-xs text-slate-400 mb-1">{p.stars} out of 5 stars from {p.count} reviews</div>
              <div className="flex justify-center gap-0.5">
                {[1,2,3,4].map(i => <Star key={i} />)}
                <Star filled={false} />
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
