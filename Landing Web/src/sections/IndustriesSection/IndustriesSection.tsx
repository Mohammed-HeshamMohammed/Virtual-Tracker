"use client"

const INDUSTRIES = [
  "Marketing agencies", "Real estate", "BPO",
  "VAs", "Staffing and recruiting", "Software development",
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

export default function IndustriesSection() {
  return (
    <Section className="py-20">
      <h2 className="text-3xl md:text-5xl font-extrabold text-[#0f172a] text-center mb-4">
        Global time tracking that<br />adapts to any industry
      </h2>
      <p className="text-slate-500 text-center mb-12">Seamlessly manage your global team from one powerful platform.</p>
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {INDUSTRIES.map((ind, i) => (
          <div key={ind} className="relative rounded-2xl overflow-hidden group cursor-pointer" style={{ height: 180 }}>
            <div className="absolute inset-0 flex items-center justify-center" style={{
              background: ["linear-gradient(135deg, #334155, #1e293b)", "linear-gradient(135deg, #1e3a5f, #0f2744)", "linear-gradient(135deg, #1a2744, #0f172a)", "linear-gradient(135deg, #1e293b, #0f172a)", "linear-gradient(135deg, #7c3aed, #4c1d95)", "linear-gradient(135deg, #0f172a, #1e293b)"][i]
            }}>
              <div className="text-slate-600 text-6xl font-black opacity-10 select-none">{ind[0]}</div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              <span className="text-white font-bold text-sm">{ind}</span>
              <ArrowRight className="w-4 h-4 text-white/70" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
