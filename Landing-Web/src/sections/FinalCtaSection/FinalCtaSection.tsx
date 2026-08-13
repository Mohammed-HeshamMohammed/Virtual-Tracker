"use client"

import AppCtaLink from "@/components/AppCtaLink"
import { getTrialHref } from "@/lib/site-urls"
import { AgentDownloadChoices } from "@/components/AgentDownloadChoices"

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`px-6 md:px-12 lg:px-20 ${className}`}>{children}</section>
}

export default function FinalCtaSection() {
  return (
    <div style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #0f172a 100%)" }} className="py-20 text-center">
      <Section>
        <div className="text-5xl mb-4">💻</div>
        <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
          Download Virtual Tracker Agent
        </h2>
        <p className="text-white/60 max-w-xl mx-auto mb-10 text-sm md:text-base">
          Get the desktop tracker for Windows, macOS, or Linux. Automated screenshots, task tracking, and seamless activity sync.
        </p>

        <AgentDownloadChoices className="mb-12" />

        <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-white/50">
          <span>Prefer using the web dashboard directly?</span>
          <AppCtaLink
            href={getTrialHref()}
            className="inline-block px-6 py-2.5 rounded-full font-semibold text-xs text-white hover:bg-white/10 transition-all border border-white/20"
          >
            Open Web Dashboard &rarr;
          </AppCtaLink>
        </div>
      </Section>
    </div>
  )
}
