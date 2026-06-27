"use client"

import AppCtaLink from "@/components/AppCtaLink"
import { getTrialHref } from "@/lib/site-urls"

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

export default function FinalCtaSection() {
  return (
    <div style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #6d28d9 100%)" }} className="py-20 text-center">
      <Section>
        <div className="text-5xl mb-4">🔥</div>
        <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
          Start with the Virtual Tracker trial client
        </h2>
        <p className="text-white/50 mb-8">Open the dashboard or request a guided walkthrough.</p>
        <AppCtaLink
          href={getTrialHref()}
          className="inline-block px-8 py-4 rounded-full font-bold text-base text-white shadow-xl shadow-black/30 hover:scale-105 transition-transform"
          style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}
        >
          Get started
        </AppCtaLink>
      </Section>
    </div>
  )
}
