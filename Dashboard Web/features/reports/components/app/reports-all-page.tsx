/* eslint-disable react-doctor/js-combine-iterations */
"use client"

import { useState } from "react"
import { Search, Trash2, Zap, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { usePageSearch } from "@/shared/ui/layout"
import {
  REPORTS_CUSTOMIZED,
  REPORTS_POPULAR,
  REPORTS_SECTIONS,
} from "@/features/reports/components/shared/constants"

function IllustrationTimeActivity({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} fill="none" aria-hidden>
      <rect x="24" y="20" width="100" height="80" rx="8" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="2" />
      <rect x="36" y="36" width="32" height="8" rx="2" fill="#38bdf8" opacity="0.5" />
      <rect x="36" y="52" width="48" height="6" rx="2" fill="#bae6fd" />
      <rect x="36" y="64" width="40" height="6" rx="2" fill="#bae6fd" />
      <circle cx="150" cy="70" r="28" fill="#fef3c7" stroke="#fcd34d" strokeWidth="2" />
      <path d="M140 65 L150 75 L165 58" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IllustrationAmounts({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} fill="none" aria-hidden>
      <rect x="40" y="28" width="72" height="56" rx="6" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="2" />
      <rect x="48" y="40" width="36" height="14" rx="2" fill="#0369a1" opacity="0.85" />
      <rect x="52" y="44" width="28" height="6" rx="1" fill="#e0f2fe" />
      <rect x="120" y="40" width="48" height="64" rx="6" fill="#fef9c3" stroke="#fde047" strokeWidth="2" />
      <rect x="128" y="52" width="32" height="8" rx="2" fill="#facc15" opacity="0.6" />
      <circle cx="64" cy="88" r="20" fill="#dbeafe" stroke="#60a5fa" strokeWidth="2" />
    </svg>
  )
}

function IllustrationDaily({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} fill="none" aria-hidden>
      <rect x="32" y="48" width="136" height="52" rx="6" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="2" />
      <rect x="44" y="72" width="16" height="20" rx="2" fill="#38bdf8" />
      <rect x="68" y="64" width="16" height="28" rx="2" fill="#0ea5e9" />
      <rect x="92" y="56" width="16" height="36" rx="2" fill="#0284c7" />
      <rect x="116" y="68" width="16" height="24" rx="2" fill="#38bdf8" />
      <ellipse cx="100" cy="32" rx="36" ry="14" fill="#dbeafe" stroke="#93c5fd" strokeWidth="2" />
    </svg>
  )
}

export function ReportsAllPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const { query: q, setQuery: setQ } = usePageSearch()
  const [custom, setCustom] = useState(() => [...REPORTS_CUSTOMIZED])

  const filterText = (title: string, desc: string) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return title.toLowerCase().includes(s) || desc.toLowerCase().includes(s)
  }

// eslint-disable-next-line react-doctor/js-combine-iterations
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-7xl space-y-12 px-4 py-8 sm:px-6 lg:px-8",
        isDark ? "text-[#dce1fb]" : "text-slate-900"
      )}
    >
      {/* Customized reports — title + search on first row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={cn("text-lg font-bold shrink-0", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
          Customized reports
        </h2>
        <div
          className={cn(
            "flex w-full max-w-md items-center gap-2 rounded-full border px-4 py-2.5 sm:ml-auto sm:w-80 sm:max-w-none shrink-0",
            isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
          )}
        >
          <Search className={cn("h-4 w-4 shrink-0", isDark ? "text-white/35" : "text-slate-400")} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search reports"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm outline-none border-0 focus:ring-0",
              isDark ? "text-[#dce1fb] placeholder:text-white/30" : "text-slate-800 placeholder:text-slate-400"
            )} aria-label="Interactive control"
          />
        </div>
      </div>

      <section className="mt-4">
        {custom.filter(item => filterText(item.title, item.tag)).length === 0 ? (
          <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>
            {custom.length === 0 ? "No saved customized reports yet." : "No matches for your search."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {custom.filter(item => filterText(item.title, item.tag)).map(item => (
              <div
                key={item.id}
                className={cn(
                  "relative flex min-w-[200px] max-w-xs flex-1 flex-col rounded-xl border p-4 transition-shadow hover:shadow-md",
                  isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(item.navigateTo)}
                    className="text-left text-sm font-bold hover:underline"
                  >
                    {item.title}
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      setCustom(prev => prev.filter(x => x.id !== item.id))
                    }}
                    className={cn(
                      "shrink-0 rounded-lg p-1 transition-colors",
                      isDark ? "text-white/40 hover:bg-white/10 hover:text-white/70" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    )}
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <span
                  className={cn(
                    "mt-3 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    isDark ? "bg-white/10 text-[#bccbb9]" : "bg-slate-100 text-slate-600"
                  )}
                >
                  {item.tag}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Popular reports */}
      <section>
        <h2 className={cn("mb-4 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Popular reports</h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {REPORTS_POPULAR.filter(item => filterText(item.title, item.description)).map(item => {
            const Ill =
              item.id === "p1"
                ? IllustrationTimeActivity
                : item.id === "p2"
                  ? IllustrationAmounts
                  : IllustrationDaily
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.navigateTo)}
                className={cn(
                  "flex flex-col rounded-2xl border p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg",
                  isDark
                    ? "border-sky-500/20 bg-linear-to-b from-sky-950/80 to-[#151b2d]"
                    : "border-sky-100 bg-linear-to-b from-sky-50 to-sky-100/80"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className={cn("text-xl font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{item.title}</h3>
                  {item.badge && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      <Zap className="h-3 w-3" />
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className={cn("mt-2 flex-1 text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                  {item.description}
                </p>
                <Ill className="mt-4 h-28 w-full" />
              </button>
            )
          })}
        </div>
      </section>

      {/* Categorized grids */}
      {REPORTS_SECTIONS.map(section => {
        const cards = section.cards.filter(c => filterText(c.title, c.description))
        if (cards.length === 0) return null
        return (
          <section key={section.heading}>
            <h2 className={cn("mb-4 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
              {section.heading}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map(card => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => onNavigate(card.navigateTo)}
                  className={cn(
                    "flex flex-col rounded-xl border p-4 text-left transition-all hover:shadow-md",
                    isDark ? "border-white/10 bg-white/5 hover:border-white/20" : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={cn("text-sm font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{card.title}</h3>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 opacity-40", isDark ? "text-white" : "text-slate-500")} />
                  </div>
                  <p className={cn("mt-2 text-xs leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {card.description}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

