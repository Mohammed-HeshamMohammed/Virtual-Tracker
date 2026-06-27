"use client"

import Link from "next/link"
import { VALUE_PROPS } from "@/lib/product-content"

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

export default function TestimonialsSection() {
  return (
    <div className="py-20 bg-[#f0f4ff]">
      <Section>
        <div className="text-center mb-4">
          <span className="text-[#7c3aed] text-xs font-bold uppercase tracking-widest">How the platform is built</span>
        </div>
        <h2 className="text-3xl md:text-5xl font-extrabold text-[#0f172a] text-center mb-12">
          Designed for accountable, visible work
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {VALUE_PROPS.map((item) => (
            <div key={item.title} className="rounded-2xl p-6 flex flex-col bg-white border border-slate-200 shadow-sm min-h-[220px]">
              <h3 className="text-lg font-extrabold text-slate-900 mb-3">{item.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed flex-1">{item.body}</p>
              <Link href={item.href} className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-[#7c3aed] hover:gap-2.5 transition-all">
                Learn more <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
