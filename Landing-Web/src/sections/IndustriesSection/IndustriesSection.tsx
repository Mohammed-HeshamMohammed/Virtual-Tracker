"use client"

import Link from "next/link"
import { SOLUTIONS } from "@/lib/product-content"
import { clampIndex } from "@/lib/safe"

const CARD_BACKGROUNDS = [
  "linear-gradient(135deg, #334155, #1e293b)",
  "linear-gradient(135deg, #1e3a5f, #0f2744)",
  "linear-gradient(135deg, #7c3aed, #4c1d95)",
  "linear-gradient(135deg, #0f172a, #1e293b)",
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
        Built for teams that need<br />visibility without guesswork
      </h2>
      <p className="text-slate-500 text-center mb-12 max-w-2xl mx-auto">
        Virtual Tracker targets operations leaders running remote teams, client delivery, and trial rollouts on Firebase.
      </p>
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {SOLUTIONS.map((item, i) => (
          <Link
            key={item.title}
            href={item.href}
            className="relative rounded-2xl overflow-hidden group p-6 min-h-[140px] flex flex-col justify-end"
            style={{ background: CARD_BACKGROUNDS[clampIndex(i, CARD_BACKGROUNDS.length)] }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white font-bold text-lg">{item.title}</span>
                <p className="text-white/70 text-sm mt-2 max-w-sm">{item.description}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>
    </Section>
  )
}
