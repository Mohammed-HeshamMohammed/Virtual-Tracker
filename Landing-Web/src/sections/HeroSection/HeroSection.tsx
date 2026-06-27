"use client"

import { useState } from "react"
import Announcement from "./Announcement"
import HeroTitle from "./HeroTitle"
import HeroSubtitle from "./HeroSubtitle"
import EmailForm from "./EmailForm"
import HeroTabs from "./HeroTabs"
import HeroSlides from "./HeroSlides"

export default function HeroSection() {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div className="relative overflow-hidden" style={{ background: "#2d2060" }}>
      <div className="pointer-events-none absolute inset-0 select-none" style={{
        backgroundImage: "radial-gradient(75% 60% at 50% 45%, rgba(210,205,255,0.55) 0%, rgba(100,90,200,0.45) 25%, rgba(45,32,96,0.85) 55%, rgba(20,15,55,0.95) 100%)",
      }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize: "200px 200px",
      }} />

      <div className="relative max-w-7xl mx-auto px-6 md:px-12 py-32 text-center">
        <Announcement />
        <HeroTitle />
        <HeroSubtitle />
        <EmailForm />
        
        <div className="flex items-center justify-center gap-6 text-xs mb-12" style={{ color: "rgba(255,255,255,0.7)" }}>
          {["Web dashboard", "Desktop agent (Win/Mac)", "Firebase-backed org data"].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <svg viewBox="0 0 12 12" className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 6l3 3 5-5" />
              </svg>
              {t}
            </span>
          ))}
        </div>

        <HeroTabs activeTab={activeTab} onTabChange={(i) => setActiveTab(i)} />
        <HeroSlides activeTab={activeTab} />
      </div>
    </div>
  )
}
