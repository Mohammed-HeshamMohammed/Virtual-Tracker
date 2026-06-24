"use client"

import { useState } from "react"
import NavigationBar from "./layout/NavigationBar"
import Footer from "./layout/Footer"
import HeroSection from "./sections/HeroSection"
import StatsSection from "./sections/StatsSection"
import CtaDemoSection from "./sections/CtaDemoSection"
import FeaturesSection from "./sections/FeaturesSection"
import TestimonialsSection from "./sections/TestimonialsSection"
import TrustSection from "./sections/TrustSection"
import IndustriesSection from "./sections/IndustriesSection"
import FinalCtaSection from "./sections/FinalCtaSection"

export default function HomePage() {
  const [activeFeature, setActiveFeature] = useState(0)

  return (
    <div className="min-h-screen bg-white font-sans" style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <NavigationBar />

      <HeroSection />

      <StatsSection />

      <CtaDemoSection />

      <FeaturesSection activeFeature={activeFeature} setActiveFeature={setActiveFeature} />

      <TestimonialsSection />

      <TrustSection />

      <IndustriesSection />

      <FinalCtaSection />

      <Footer />
    </div>
  )
}
