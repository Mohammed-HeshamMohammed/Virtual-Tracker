"use client"

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

export default function CtaDemoSection() {
  return (
    <Section className="py-16">
      <div className="relative rounded-3xl overflow-hidden max-w-5xl mx-auto" style={{ background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)" }}>
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 70% 50%, white 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }} />
        <div className="relative flex flex-col md:flex-row items-center gap-8 p-8 md:p-12">
          <div className="flex-1">
            <h2 className="text-3xl font-extrabold text-white mb-4">See Virtual Tracker in action</h2>
            <p className="text-white/75 mb-6 leading-relaxed">
              Discover how our time tracking software brings together productivity insights, automated payments, and more â try our interactive demo or start a trial today!
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="px-5 py-3 rounded-full bg-white/10 border border-white/30 text-white font-semibold text-sm hover:bg-white/20 transition-colors">
                Try a demo now
              </button>
              <button className="px-5 py-3 rounded-full bg-white text-[#2563eb] font-semibold text-sm hover:bg-white/90 transition-colors">
                Start a free trial
              </button>
            </div>
          </div>
          <div className="w-full md:w-80 bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <div className="w-6 h-6 rounded bg-violet-100 flex items-center justify-center">
                <svg viewBox="0 0 16 16" className="w-4 h-4 text-violet-600" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a1 1 0 011 1v3.5l2 2a1 1 0 11-1.4 1.4l-2.3-2.3A1 1 0 017 9V4a1 1 0 011-1z" />
                </svg>
              </div>
              <span className="text-xs font-bold text-slate-700">02:44:15</span>
              <div className="flex-1" />
              <div className="w-6 h-6 rounded-full bg-slate-200" />
            </div>
            <div className="p-4">
              <div className="text-lg font-bold text-slate-800 mb-3">Dashboard</div>
              <div className="grid grid-cols-2 gap-2">
                {[["$1,852.50", "Spent this week", "â ¬ $211"], ["80:22:23", "Worked today", "â¬ 1:52"], ["131:42", "This week", "â¬ 1:22"], ["81%", "Activity", "â¬ 3%"]].map(([v, l, d]) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-2.5">
                    <div className="text-[9px] text-slate-400 mb-0.5">{l}</div>
                    <div className="text-sm font-bold text-slate-800">{v}</div>
                    <div className="text-[9px] text-emerald-500">{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
