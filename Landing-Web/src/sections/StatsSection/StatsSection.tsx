"use client"

import { PLATFORM_STATS } from "@/lib/product-content"

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

export default function StatsSection() {
  return (
    <div style={{ background: "linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)" }} className="py-16">
      <Section>
        <p className="text-center text-white/40 text-sm font-medium tracking-widest uppercase mb-10">
          Platform facts from the current codebase
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
          {PLATFORM_STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl md:text-4xl font-extrabold text-white mb-1">{s.value}</div>
              <div className="text-white/40 text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
