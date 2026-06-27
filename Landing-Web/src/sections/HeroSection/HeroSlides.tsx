"use client"

import type { ReactNode } from "react"
import { HERO_TABS } from "@/lib/product-content"
import { clampIndex } from "@/lib/safe"

interface HeroSlidesProps {
  activeTab: number
}

export default function HeroSlides({ activeTab }: HeroSlidesProps) {
  const tabIndex = clampIndex(activeTab, HERO_TABS.length)
  const tab = HERO_TABS[tabIndex]

  const slides: Record<number, ReactNode> = {
    0: (
      <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] text-white/50 uppercase tracking-wider font-bold">Active task</div>
            <div className="text-sm font-semibold text-white mt-0.5">Implement timesheet API</div>
          </div>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Timer on
          </span>
        </div>
        <div className="text-4xl font-mono font-bold tracking-tight mb-4 text-center text-white bg-black/25 py-3 rounded-lg border border-white/5">
          01:24:08
        </div>
        <p className="text-xs text-white/60 text-center">Web dashboard timer · tied to project tasks</p>
      </div>
    ),
    1: (
      <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg space-y-3">
        <div className="text-sm font-semibold text-white">Activity feeds (while timer runs)</div>
        {["Screenshots", "Apps", "URLs"].map((feed) => (
          <div key={feed} className="flex items-center justify-between text-xs bg-white/5 p-2.5 rounded border border-white/5">
            <span className="text-white/90 font-medium">{feed}</span>
            <span className="text-emerald-400 font-bold">Live</span>
          </div>
        ))}
        <p className="text-[10px] text-white/50 pt-1">Desktop agent on Windows & macOS</p>
      </div>
    ),
    2: (
      <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
        <div className="text-sm font-semibold text-white mb-3">Project management</div>
        <div className="space-y-2 text-xs">
          {["Client: Acme Ops", "Project: Q2 rollout", "Task: Review activity scope"].map((row) => (
            <div key={row} className="flex items-center gap-2 p-2.5 rounded bg-white/5 border border-white/5 text-white/85">
              <span className="h-2 w-2 rounded-full bg-violet-400" />
              {row}
            </div>
          ))}
        </div>
      </div>
    ),
    3: (
      <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg space-y-3">
        <div className="text-sm font-semibold text-white">People & presence</div>
        {[
          { name: "Team lead", status: "Online", on: true },
          { name: "Member", status: "Online", on: true },
          { name: "Viewer", status: "Away", on: false },
        ].map((m) => (
          <div key={m.name} className="flex items-center justify-between text-xs bg-white/5 p-2.5 rounded border border-white/5">
            <span className="text-white font-medium">{m.name}</span>
            <span className={m.on ? "text-emerald-400" : "text-amber-400"}>{m.status}</span>
          </div>
        ))}
        <p className="text-[10px] text-white/50">Invites · hierarchy tree · WebSocket presence</p>
      </div>
    ),
    4: (
      <div className="max-w-md mx-auto w-full bg-white/5 rounded-xl border border-white/10 p-5 shadow-lg">
        <div className="text-sm font-semibold text-white mb-3">Python desktop agent</div>
        <ul className="space-y-2 text-xs text-white/80">
          <li>· Secure link via dashboard query param</li>
          <li>· Screenshots on a random 90–210s interval</li>
          <li>· Foreground app logging every 30s</li>
          <li>· Browser URL capture (Win & macOS)</li>
        </ul>
      </div>
    ),
  }

  return (
    <div className="relative mx-auto max-w-4xl select-none">
      <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50 bg-[#151030]/90 backdrop-blur-md p-6 min-h-[320px] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="text-[10px] text-white/40 ml-2 font-mono">Virtual Tracker dashboard</span>
          </div>
          <span className="text-[10px] text-white/30 font-mono">{tab.label}</span>
        </div>
        <div className="flex-1 flex flex-col justify-center items-center py-6">
          {slides[tabIndex] ?? slides[0]}
        </div>
      </div>
    </div>
  )
}
