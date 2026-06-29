"use client"

import {
  ArrowRight,
  Banknote,
  CreditCard,
  FileText,
  Landmark,
  Layers,
  Receipt,
  Wallet,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import {
  FINANCIALS_OVERVIEW_KPIS,
  FINANCIALS_OVERVIEW_RECENT_INVOICES,
  FINANCIALS_OVERVIEW_RECENT_PAYMENTS,
} from "@/features/financials/components/overview/overview-snapshot"

const NAV_CARDS = [
  {
    id: "financials-payroll",
    title: "Manage payroll",
    description: "Wise & payout integrations, payroll adjustments.",
    icon: Landmark,
  },
  {
    id: "financials-create",
    title: "Create payments",
    description: "Pay hours, approved timesheets, and one-time payments.",
    icon: Banknote,
  },
  {
    id: "financials-records",
    title: "Payment records",
    description: "History, status, and export for all payment runs.",
    icon: CreditCard,
  },
  {
    id: "financials-invoices",
    title: "Invoices",
    description: "Client & team billing, drafts, and collections.",
    icon: FileText,
  },
  {
    id: "financials-expenses",
    title: "Expenses",
    description: "Uninvoiced, invoiced, and reimbursed spend.",
    icon: Receipt,
  },
]

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  isDark,
  accentClass,
}: {
  label: string
  value: string
  hint?: string
  icon: typeof Wallet
  isDark: boolean
  accentClass: string
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 transition-shadow hover:shadow-md",
        isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accentClass)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      <p className={cn("mt-3 text-2xl font-bold tracking-tight", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
        {value}
      </p>
      <p className={cn("text-xs font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
        {label}
      </p>
      {hint && (
        <p className={cn("mt-2 text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{hint}</p>
      )}
    </div>
  )
}

const PAY_STATUS_STYLES: Record<string, string> = {
  Paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Processing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
}

const INV_STATUS_STYLES: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Closed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
}

export function FinancialsOverviewPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const k = FINANCIALS_OVERVIEW_KPIS

  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-10 pb-10", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            isDark={isDark}
            icon={Wallet}
            accentClass="bg-gradient-to-br from-violet-500 to-purple-600"
            label="Ready to pay (hours)"
            value={k.readyToPayTotal}
            hint={`${k.readyToPayMembers} members in pay-hours queue`}
          />
          <KpiCard
            isDark={isDark}
            icon={Banknote}
            accentClass="bg-gradient-to-br from-blue-500 to-sky-600"
            label="Approved timesheets"
            value={k.approvedPayrollTotal}
            hint={`${k.approvedPayrollMembers} members · next run eligible`}
          />
          <KpiCard
            isDark={isDark}
            icon={Landmark}
            accentClass="bg-gradient-to-br from-emerald-500 to-teal-600"
            label="Payroll provider"
            value={k.payrollConnected ? "Connected" : "Not connected"}
            hint={`${k.payrollProvider} · connect under Manage payroll`}
          />
          <KpiCard
            isDark={isDark}
            icon={CreditCard}
            accentClass="bg-gradient-to-br from-slate-600 to-slate-800"
            label="Payment records"
            value={k.paymentsVolumePaid}
            hint={`${k.paymentsPaidCount} paid · ${k.paymentsPendingCount} pending/processing · last ${k.paymentsLastRunLabel}`}
          />
          <KpiCard
            isDark={isDark}
            icon={FileText}
            accentClass="bg-gradient-to-br from-amber-500 to-orange-600"
            label="Open invoice balance"
            value={k.invoicesOpenAmount}
            hint={`${k.invoicesOpenCount} open · ${k.invoicesDraftCount} drafts · ${k.invoicesCollected30d} collected (sample)`}
          />
          <KpiCard
            isDark={isDark}
            icon={Receipt}
            accentClass="bg-gradient-to-br from-rose-500 to-pink-600"
            label="Expense pipeline"
            value={k.expensesUninvoiced}
            hint={`Uninvoiced · ${k.expensesInvoiced} invoiced · ${k.expensesPaidYtd} paid (demo)`}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div
          className={cn(
            "rounded-2xl border p-5",
            isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-white"
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
              Recent payment runs
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("financials-records")}
              className="text-xs font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400"
            >
              View all
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {FINANCIALS_OVERVIEW_RECENT_PAYMENTS.map((row: any) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                    {row.name}
                  </p>
                  <p className={cn("text-xs", isDark ? "text-white/40" : "text-slate-400")}>{row.id}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{row.amount}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      PAY_STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                    )}
                  >
                    {row.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          className={cn(
            "rounded-2xl border p-5",
            isDark ? "border-white/10 bg-white/3" : "border-slate-200 bg-white"
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
              Recent invoices
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("financials-invoices")}
              className="text-xs font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400"
            >
              View all
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {FINANCIALS_OVERVIEW_RECENT_INVOICES.map((row: any) => (
              <li key={row.number} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
                    {row.number}
                  </p>
                  <p className={cn("truncate text-xs", isDark ? "text-white/40" : "text-slate-500")}>{row.client}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{row.total}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      INV_STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                    )}
                  >
                    {row.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className={cn("mb-4 text-sm font-bold uppercase tracking-wider", isDark ? "text-white/45" : "text-slate-500")}>
          Financials areas
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NAV_CARDS.map(card => {
            const Icon = card.icon
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className={cn(
                  "group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-all hover:shadow-md",
                  isDark
                    ? "border-white/10 bg-white/3 hover:border-white/20"
                    : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                    isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>{card.title}</span>
                    <ArrowRight
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5",
                        isDark ? "text-white/35" : "text-slate-400"
                      )}
                    />
                  </div>
                  <p className={cn("mt-1 text-sm leading-snug", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {card.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
