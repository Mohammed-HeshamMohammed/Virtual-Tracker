"use client"

import type { ReactNode } from "react"
import { ExternalLink, Headphones } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { IntegrationConnectCard, PreferredBadge } from "@/features/settings/components/integrations/components/integration-connect-card"
import { ProjectManagementIntegrationsSection } from "@/features/settings/components/integrations/project-management/project-management-section"

function PopularCard({
  title,
  description,
  logo,
  isDark,
}: {
  title: string
  description: string
  logo: ReactNode
  isDark: boolean
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-5 min-h-[200px]",
        isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-200 bg-white"
      )}
    >
      <div className="absolute left-4 top-4">
        <PreferredBadge />
      </div>
      <button
        type="button"
        className="absolute right-4 top-4 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
      >
        Connect
      </button>
      <div className="mt-10 flex flex-col gap-3 pr-20">
        <div className="h-10 w-10 flex items-center justify-center shrink-0">{logo}</div>
        <h3 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{title}</h3>
        <p className={cn("text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-600")}>{description}</p>
      </div>
      <a
        href="#"
        className="mt-auto pt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400"
      >
        Learn more
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  )
}

export function IntegrationsSettingsPage() {
  const { isDark } = useTheme()

  return (
    <div
      className={cn(
        "w-full max-w-6xl mx-auto pb-10 space-y-12",
        isDark ? "text-[#dce1fb]" : "text-slate-900"
      )}
    >
      <header>
        <h1 className={cn("text-2xl font-bold tracking-tight", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
          Integrations
        </h1>
        <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
          Connect tools for payments, projects, payroll, and team communication.
        </p>
      </header>

      {/* Most popular */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Most popular</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PopularCard
            isDark={isDark}
            title="Wise"
            description="Easy international payments and low processing fees."
            logo={
              <div className="h-10 w-10 rounded-lg bg-[#9fe870] flex items-center justify-center text-[#163300] font-black text-lg">
                W
              </div>
            }
          />
          <PopularCard
            isDark={isDark}
            title="Jira"
            description="Made for complex projects or everyday tasks."
            logo={<div className="h-10 w-10 rounded-lg bg-[#0052CC] flex items-center justify-center text-white font-bold">J</div>}
          />
          <PopularCard
            isDark={isDark}
            title="Slack"
            description="Secure communication with your team."
            logo={
              <div className="grid grid-cols-2 gap-0.5 w-10 h-10">
                <span className="rounded-sm bg-[#E01E5A]" />
                <span className="rounded-sm bg-[#36C5F0]" />
                <span className="rounded-sm bg-[#2EB67D]" />
                <span className="rounded-sm bg-[#ECB22E]" />
              </div>
            }
          />
        </div>
      </section>

      {/* Connected */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Connected</h2>
        <div
          className={cn(
            "rounded-xl border overflow-hidden",
            isDark ? "border-white/10 bg-[#151b2d]" : "border-slate-200 bg-white"
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[520px]">
              <thead>
                <tr className={cn("border-b", isDark ? "border-white/10 bg-[#191f31]/50" : "border-slate-200 bg-slate-50")}>
                  <th className={cn("px-4 py-3 font-semibold", isDark ? "text-[#bccbb9]" : "text-slate-600")}>App</th>
                  <th className={cn("px-4 py-3 font-semibold", isDark ? "text-[#bccbb9]" : "text-slate-600")}>Last Sync</th>
                  <th className={cn("px-4 py-3 font-semibold", isDark ? "text-[#bccbb9]" : "text-slate-600")}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className={cn("border-b", isDark ? "border-white/5" : "border-slate-100")}>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-[#006e2f] flex items-center justify-center text-white text-xs font-bold">
                        HT
                      </div>
                      <button type="button" className="font-medium text-blue-500 hover:underline text-left">
                        Hubstaff Tasks (linked)
                      </button>
                    </div>
                  </td>
                  <td className={cn("px-4 py-4", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                    Tue, Apr 7, 2026 9:55 pm MDT
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex rounded-full bg-green-500/15 text-green-600 dark:text-green-400 px-2.5 py-0.5 text-xs font-semibold">
                      Active
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            className={cn(
              "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 text-xs",
              isDark ? "border-t border-white/10 text-[#bccbb9]" : "border-t border-slate-200 text-slate-500"
            )}
          >
            <span>Showing 1 integration</span>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold",
                  "bg-blue-500 text-white"
                )}
              >
                1
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Payment processors */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Payment processors</h2>
        <div
          className={cn(
            "relative rounded-2xl border overflow-hidden p-6 md:p-8 md:flex md:gap-10 md:items-center",
            isDark ? "border-white/10 bg-[#1a1f2e]" : "border-slate-200 bg-slate-50"
          )}
        >
          <div className="absolute left-6 top-6">
            <PreferredBadge />
          </div>
          <div className="mt-12 md:mt-0 flex-1 space-y-4 max-w-xl">
            <div className="h-10 w-10 rounded-lg bg-[#9fe870] flex items-center justify-center text-[#163300] font-black text-lg">
              W
            </div>
            <h3 className={cn("text-xl font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Pay your team with Wise</h3>
            <p className={cn("text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
              Experience fast and secure transactions, automated payroll, and the lowest international fees, all in just a few
              clicks.
            </p>
            <button
              type="button"
              className="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 w-fit"
            >
              Connect to Wise
            </button>
          </div>
          <div
            className={cn(
              "mt-8 md:mt-0 relative h-48 md:h-56 md:w-72 rounded-xl overflow-hidden shrink-0",
              "bg-gradient-to-br from-slate-200 to-slate-400 dark:from-[#2e3447] dark:to-[#191f31]"
            )}
          >
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-white/30 text-sm font-medium">
              Preview
            </div>
            <span className="absolute left-3 top-3 rounded-full bg-[#9fe870]/90 text-[#163300] text-[10px] font-bold px-2 py-1">
              Best exchange rates
            </span>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 text-slate-800 text-[10px] font-semibold px-2 py-1 shadow">
              Money sent 3450.00 BRL ↑
            </span>
            <span className="absolute right-3 bottom-3 rounded-full bg-[#9fe870]/90 text-[#163300] text-[10px] font-bold px-2 py-1">
              Fast &amp; secure transactions
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <IntegrationConnectCard
            name="Wise"
            logo={<div className="h-12 w-12 rounded-xl bg-[#9fe870] flex items-center justify-center text-[#163300] font-black">W</div>}
          />
          <IntegrationConnectCard
            name="PayPal"
            logo={<div className="h-12 w-12 rounded-xl bg-[#003087] flex items-center justify-center text-white font-bold text-xs">P</div>}
          />
          <IntegrationConnectCard
            name="Payoneer V4"
            logo={
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-orange-400 via-yellow-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                P
              </div>
            }
          />
          <IntegrationConnectCard
            name="Bitwage"
            logo={<div className="h-12 w-12 rounded-xl bg-black flex items-center justify-center text-white font-bold">B</div>}
          />
        </div>
      </section>

      {/* Payroll & accounting */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
          Payroll providers &amp; accounting
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <IntegrationConnectCard
            name="Deel"
            logo={<div className="h-12 w-12 rounded-xl bg-[#1a56f0] flex items-center justify-center text-white font-bold lowercase">d.</div>}
          />
          <IntegrationConnectCard
            name="Gusto"
            logo={<div className="h-12 w-12 rounded-xl bg-[#f45d48] flex items-center justify-center text-white font-bold lowercase">g</div>}
          />
          <IntegrationConnectCard
            name="QuickBooks"
            logo={<div className="h-12 w-12 rounded-full bg-[#2ca01c] flex items-center justify-center text-white text-[10px] font-bold">qb</div>}
          />
          <IntegrationConnectCard
            name="FreshBooks"
            logo={<div className="h-12 w-12 rounded-xl bg-sky-600 flex items-center justify-center text-white text-xs font-bold">FB</div>}
          />
        </div>
      </section>

      {/* Help desk */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Help desk</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-2xl">
          <IntegrationConnectCard
            name="Freshdesk"
            logo={
              <div className="h-12 w-12 rounded-full bg-[#2a9134] flex items-center justify-center text-white">
                <Headphones className="w-6 h-6" strokeWidth={2} />
              </div>
            }
          />
          <IntegrationConnectCard
            name="Zendesk"
            logo={<div className="h-12 w-12 rounded-xl bg-[#03363d] flex items-center justify-center text-[#f0f4f8] font-bold">Z</div>}
          />
        </div>
      </section>

      {/* Communication */}
      <section className="space-y-4">
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Communication</h2>
        <div className="max-w-[200px]">
          <IntegrationConnectCard
            name="Slack"
            logo={
              <div className="grid grid-cols-2 gap-0.5 w-12 h-12">
                <span className="rounded-md bg-[#E01E5A]" />
                <span className="rounded-md bg-[#36C5F0]" />
                <span className="rounded-md bg-[#2EB67D]" />
                <span className="rounded-md bg-[#ECB22E]" />
              </div>
            }
          />
        </div>
      </section>

      <ProjectManagementIntegrationsSection isDark={isDark} />
    </div>
  )
}

