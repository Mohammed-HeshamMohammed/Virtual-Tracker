"use client"

import { useState } from "react"
import PageShell from "@/components/PageShell"
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
      <HeroSection />
      <StatsSection />
      <CtaDemoSection />
      <FeaturesSection activeFeature={activeFeature} setActiveFeature={setActiveFeature} />
      <TestimonialsSection />
      <TrustSection />
      <IndustriesSection />
      <FinalCtaSection />
    </PageShell>
  )
}
