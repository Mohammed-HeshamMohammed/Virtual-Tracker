"use client"

import { useState } from "react"

const HERO_TABS = [
  { label: "Employee time tracking",  icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Productivity monitoring", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { label: "Project tracking",        icon: "M4 6h16M4 10h16M4 14h16M4 18h16" },
  { label: "Workforce analytics",     icon: "M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { label: "Global payments",         icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
]

interface HeroTabsProps {
  activeTab: number
  onTabChange: (tab: number) => void
}

export default function HeroTabs({ activeTab, onTabChange }: HeroTabsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mb-8">
      {HERO_TABS.map((tab, i) => (
        <button
          key={tab.label}
          onClick={() => onTabChange(i)}
          className={[
            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200",
            activeTab === i
              ? "bg-white/15 border-white/30 text-white"
              : "border-white/10 text-white/70 hover:border-white/20 hover:text-white",
          ].join(" ")}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={tab.icon} />
          </svg>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
