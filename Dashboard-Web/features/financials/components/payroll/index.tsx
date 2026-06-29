"use client"

import { useState, type ReactNode } from "react"
import { AnimatePresence } from "framer-motion"
import { Check, ChevronDown, Layers, Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { usePageSearch } from "@/shared/ui/layout"
import { CreatePayrollAdjustmentModal } from "@/features/financials/components/payroll/adjust-modal"
import { PiggyEmpty } from "@/features/financials/components/shared/ui-components"
import { SmallToggle } from "@/features/financials/components/shared/ui-components"

type PayrollTab = "members" | "adjustments"

function TabBar({
  tab,
  onChange,
  isDark,
  trailing,
}: {
  tab: PayrollTab
  onChange: (t: PayrollTab) => void
  isDark: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b",
        isDark ? "border-white/10" : "border-slate-200"
      )}
    >
      <div className="flex min-w-0">
        {(
          [
            { k: "members" as const, l: "Members" },
            { k: "adjustments" as const, l: "Payroll adjustments" },
          ] as const
        ).map(({ k, l }) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              "px-5 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors",
              tab === k
                ? "border-blue-500 text-blue-500"
                : isDark
                  ? "border-transparent text-white/35 hover:text-white/55"
                  : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {trailing}
    </div>
  )
}

function WiseHeroGraphic({ isDark }: { isDark: boolean }) {
  return (
    <div
      className={cn(
        "relative h-52 w-full max-w-sm shrink-0 overflow-hidden rounded-xl border md:h-56",
        isDark ? "border-white/10 bg-gradient-to-br from-slate-700 to-slate-900" : "border-slate-200 bg-gradient-to-br from-slate-100 to-slate-300"
      )}
    >
      <div className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col gap-1">
        <div
          className={cn(
            "h-24 w-36 rounded-lg border-2 shadow-lg",
            isDark ? "border-white/20 bg-[#1a2235]" : "border-white bg-white"
          )}
        >
          <div className={cn("h-6 rounded-t-md", isDark ? "bg-[#9fe870]/30" : "bg-[#9fe870]/50")} />
          <div className="space-y-1.5 p-2">
            <div className={cn("h-1.5 w-3/4 rounded", isDark ? "bg-white/10" : "bg-slate-200")} />
            <div className={cn("h-1.5 w-1/2 rounded", isDark ? "bg-white/10" : "bg-slate-200")} />
            <div className={cn("mt-2 h-6 w-16 rounded bg-blue-500")} />
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 right-6 h-28 w-16 rounded-xl border-2 border-white bg-white shadow-xl">
        <div className="mx-auto mt-2 h-16 w-[90%] rounded-md bg-slate-100" />
        <div className="mx-auto mt-2 h-2 w-8 rounded-full bg-slate-200" />
      </div>
      <span
        className={cn(
          "absolute right-4 top-4 rounded-full px-2 py-0.5 text-[9px] font-bold",
          isDark ? "bg-[#9fe870]/20 text-[#9fe870]" : "bg-[#9fe870] text-[#163300]"
        )}
      >
        Wise
      </span>
    </div>
  )
}

function AlternatePayCard({
  name,
  logo,
  onOpenIntegrations,
  isDark,
}: {
  name: string
  logo: ReactNode
  onOpenIntegrations: () => void
  isDark: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpenIntegrations}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center transition-all hover:shadow-md",
        isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-slate-200 bg-white hover:border-slate-300"
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center">{logo}</div>
      <span className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{name}</span>
    </button>
  )
}

export function ManagePayrollPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const [tab, setTab] = useState<PayrollTab>("members")
  const [showPast, setShowPast] = useState(false)
  const { query: searchQ, setQuery: setSearchQ } = usePageSearch()
  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <div
      className={cn(
        "w-full max-w-6xl mx-auto pb-10",
        isDark ? "text-[#dce1fb]" : "text-slate-900"
      )}
    >
      <h1 className={cn("mb-4 text-2xl font-bold tracking-tight", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
        Manage payroll
      </h1>
      <div className="mb-6">
        <TabBar
          tab={tab}
          onChange={setTab}
          isDark={isDark}
          trailing={
            <button
              type="button"
              onClick={() => onNavigate("settings-integrations")}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 py-3 text-sm font-semibold transition-colors",
                isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
              )}
            >
              <Layers className="h-4 w-4" />
              Manage integrations
            </button>
          }
        />
      </div>

      {tab === "members" && (
        <div className="space-y-10">
          <div
            className={cn(
              "rounded-2xl border p-6 md:p-8",
              isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
            )}
          >
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl flex-1 space-y-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#9fe870] text-lg font-black text-[#163300]">
                  W
                </div>
                <h2 className={cn("text-xl font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                  Pay your team with Wise
                </h2>
                <p className={cn("text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                  Pay your team automatically at the end of each pay period. Just connect your Wise account and start paying
                  your team.
                </p>
                <ul className="space-y-2">
                  {["Set up in a snap", "Instant payments", "Lowest international fees"].map(item => (
                    <li key={item} className="flex items-center gap-2 text-sm text-slate-700 dark:text-[#bccbb9]">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
                  >
                    Connect to Wise
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors",
                      isDark
                        ? "border-white/20 text-[#dce1fb] hover:bg-white/10"
                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                    )}
                  >
                    Create a Wise account
                  </button>
                </div>
              </div>
              <WiseHeroGraphic isDark={isDark} />
            </div>
          </div>

          <section className="space-y-3">
            <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
              Want to use a different tool? No problem
            </h2>
            <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
              Virtual Tracker supports rich integrations with most popular payments methods.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <AlternatePayCard
                isDark={isDark}
                name="PayPal"
                onOpenIntegrations={() => onNavigate("settings-integrations")}
                logo={<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#003087] text-sm font-bold text-white">P</div>}
              />
              <AlternatePayCard
                isDark={isDark}
                name="Payoneer V4"
                onOpenIntegrations={() => onNavigate("settings-integrations")}
                logo={
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-amber-400 to-sky-600 text-xs font-bold text-white">
                    P
                  </div>
                }
              />
              <AlternatePayCard
                isDark={isDark}
                name="Bitwage"
                onOpenIntegrations={() => onNavigate("settings-integrations")}
                logo={<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black text-sm font-bold text-white">b</div>}
              />
              <AlternatePayCard
                isDark={isDark}
                name="Deel"
                onOpenIntegrations={() => onNavigate("settings-integrations")}
                logo={<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1a56f0] text-sm font-bold lowercase text-white">d.</div>}
              />
              <AlternatePayCard
                isDark={isDark}
                name="Gusto"
                onOpenIntegrations={() => onNavigate("settings-integrations")}
                logo={<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#f45d48] text-sm font-bold lowercase text-white">g</div>}
              />
            </div>
          </section>
        </div>
      )}

      {tab === "adjustments" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="relative min-w-0 w-full sm:flex-1 sm:max-w-md">
              <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", isDark ? "text-white/35" : "text-slate-400")} />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search for members"
                className={cn(
                  "w-full rounded-xl border py-2.5 pl-10 pr-10 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20",
                  isDark ? "border-white/10 bg-[#191f31] text-[#dce1fb] placeholder:text-white/30" : "border-slate-200 bg-white text-slate-800"
                )} aria-label="Interactive control"
              />
              <ChevronDown className={cn("pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2", isDark ? "text-white/35" : "text-slate-400")} />
            </div>
            <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="whitespace-nowrap rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
              >
                Create payroll adjustment
              </button>
              <label className="flex cursor-pointer items-center justify-end gap-3 rounded-lg border border-transparent px-2 py-1 sm:justify-center">
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
                  Show past adjustments
                </span>
                <SmallToggle checked={showPast} onChange={() => setShowPast((v) => !v)} />
              </label>
            </div>
          </div>

          <PiggyEmpty isDark={isDark} />
        </div>
      )}

      <AnimatePresence>
        {showCreateModal && (
          <CreatePayrollAdjustmentModal key="create-payroll-adjustment" onClose={() => setShowCreateModal(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
