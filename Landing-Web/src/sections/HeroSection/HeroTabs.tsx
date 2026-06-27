"use client"

import { HERO_TABS } from "@/lib/product-content"

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
