"use client"

import { useState } from "react"
import PageShell from "@/components/PageShell"
import SafeSection from "@/components/SafeSection"
import {
  HeroSection,
  StatsSection,
  CtaDemoSection,
  FeaturesSection,
  TestimonialsSection,
  TrustSection,
  IndustriesSection,
  FinalCtaSection,
} from "./components"

export function HomeView() {
  const [activeFeature, setActiveFeature] = useState(0)

  return (
    <PageShell>
      <SafeSection name="hero">
        <HeroSection />
      </SafeSection>
      <SafeSection name="stats">
        <StatsSection />
      </SafeSection>
      <SafeSection name="demo call-to-action">
        <CtaDemoSection />
      </SafeSection>
      <SafeSection name="features">
        <FeaturesSection activeFeature={activeFeature} setActiveFeature={setActiveFeature} />
      </SafeSection>
      <SafeSection name="value props">
        <TestimonialsSection />
      </SafeSection>
      <SafeSection name="trust">
        <TrustSection />
      </SafeSection>
      <SafeSection name="use cases">
        <IndustriesSection />
      </SafeSection>
      <SafeSection name="final call-to-action">
        <FinalCtaSection />
      </SafeSection>
    </PageShell>
  )
}
