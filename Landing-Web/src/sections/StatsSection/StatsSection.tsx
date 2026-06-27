"use client"

const STATS = [
  { value: "25%",   label: "Average productivity gain" },
  { value: "65M+",  label: "Total hours tracked" },
  { value: "15M+",  label: "Tasks completed" },
  { value: "450k+", label: "Payments processed" },
]

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

export default function StatsSection() {
  return (
    <div style={{ background: "linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)" }} className="py-16">
      <Section>
        <p className="text-center text-white/40 text-sm font-medium tracking-widest uppercase mb-10">
          Time tracking & productivity metrics trusted by 140k global users
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-14 max-w-3xl mx-auto">
          {STATS.map(s => (
            <div key={s.value} className="text-center">
              <div className="text-3xl md:text-4xl font-extrabold text-white mb-1">{s.value}</div>
              <div className="text-white/40 text-sm">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 opacity-30">
          {["NAKIVO", "CENTURY 21", "ahrefs", "CLEARDESK", "0neIMS", "AffordableStaff"].map(l => (
            <span key={l} className="text-white font-bold text-sm tracking-wider">{l}</span>
          ))}
        </div>
      </Section>
    </div>
  )
}
