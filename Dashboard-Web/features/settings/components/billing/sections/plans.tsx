"use client"

import { useState, useRef, useEffect, createContext, use } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, X, ChevronDown, Info } from "lucide-react"
import NumberFlow from "@number-flow/react"
import confetti from "canvas-confetti"
import { cn } from "@/shared/utils/utils"
import { CYCLE_OPTIONS, FREE_FEATURES } from "@/features/settings/components/shared/constants"
import { PLANS, ADDONS } from "@/features/settings/components/shared/constants"
import type { Addon } from "@/features/settings/components/shared/constants"

type Cycle = "monthly" | "quarterly" | "yearly"
type V = boolean | string

const CycleContext = createContext<{ cycle: Cycle; setCycle: (c: Cycle) => void }>({
  cycle: "monthly",
  setCycle: () => {},
})

const ADDON_MAP = Object.fromEntries(ADDONS.map(a => [a.name, a])) as Record<string, Addon>

type Row = { label: string; note?: string; free: V; starter: V; grow: V; team: V; enterprise: V }
type Section = { title: string; rows: Row[] }

const COMPARISON: Section[] = [
  {
    title: "Time tracking",
    rows: [
      { label: "Multi-platform timer app", free: true,  starter: true,  grow: true,  team: true,  enterprise: true },
      { label: "Timesheets",               free: true,  starter: true,  grow: true,  team: true,  enterprise: true },
      { label: "Timesheet approvals",      free: false, starter: false, grow: false, team: true,  enterprise: true },
      { label: "Idle time out",            free: false, starter: false, grow: true,  team: true,  enterprise: true },
      { label: "Custom time out",          free: false, starter: false, grow: false, team: true,  enterprise: true },
      { label: "Auto-discard idle time",   free: false, starter: false, grow: false, team: true,  enterprise: true },
      { label: "Background timer", note: "2", free: false, starter: false, grow: false, team: false, enterprise: true },
    ],
  },
  {
    title: "Productivity monitoring",
    rows: [
      { label: "Screenshots",          free: true,  starter: "500/user/mo",  grow: "1,500/user/mo", team: true,  enterprise: true },
      { label: "Activity levels",      free: true,  starter: true,           grow: true,            team: true,  enterprise: true },
      { label: "App and URL tracking", free: false, starter: "500/user/mo",  grow: "1,500/user/mo", team: true,  enterprise: true },
      { label: "Achievement badges",   free: false, starter: false,          grow: false,           team: true,  enterprise: true },
    ],
  },
  {
    title: "Workforce management",
    rows: [
      { label: "Dashboard",                 free: true,  starter: true,      grow: true,      team: true,  enterprise: true },
      { label: "Scheduling and attendance", free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Daily and weekly limits",   free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Time off and holidays",     free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Overtime",                  free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Work breaks",               free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Teams",                     free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Clients",                   free: "3",   starter: "5",       grow: true,      team: true,  enterprise: true },
      { label: "Client invoices",           free: true,  starter: true,      grow: true,      team: true,  enterprise: true },
      { label: "Team invoices",             free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Expense tracking",          free: false, starter: false,     grow: false,     team: true,  enterprise: true },
      { label: "Per user settings", note: "i", free: false, starter: true,  grow: true,      team: true,  enterprise: true },
      { label: "Payments and payroll",      free: false, starter: "Limited", grow: "Limited", team: true,  enterprise: true },
      { label: "Pay by bank debit (ACH)",   free: false, starter: false,     grow: false,     team: false, enterprise: true },
      { label: "Account provisioning", note: "2", free: false, starter: false, grow: false,   team: false, enterprise: true },
    ],
  },
  {
    title: "Workforce analytics",
    rows: [
      { label: "Categorized work time",        note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Smart notifications",          note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Benchmarks and trends",        note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Employee utilization",         note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Focus time",                   note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Meeting time",                 note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Behavioral highlights",        note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Suspicious activity detection",note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Work time classification",     note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Team leaderboard",             note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
      { label: "Daily timeline",               note: "1", free: false, starter: false, grow: false, team: true, enterprise: true },
    ],
  },
  {
    title: "Project management",
    rows: [
      { label: "Project budgets",        free: false, starter: false, grow: true,            team: true,  enterprise: true },
      { label: "Client budgets",         free: false, starter: false, grow: false,           team: true,  enterprise: true },
      { label: "Tasks and to-do lists",  free: "100", starter: "500", grow: "1,500",         team: true,  enterprise: true },
      { label: "Work orders and Jobs", note: "6", free: false, starter: false, grow: false,  team: false, enterprise: true },
      { label: "Integrations",           free: false, starter: false, grow: "1 integration", team: true,  enterprise: true },
    ],
  },
  {
    title: "Security and Privacy",
    rows: [
      { label: "HIPAA compliance",          free: false, starter: false, grow: false, team: false, enterprise: true },
      { label: "SOC-2 Type II compliance", note: "i", free: false, starter: false, grow: false, team: false, enterprise: true },
      { label: "Single sign-on",            free: false, starter: false, grow: false, team: false, enterprise: true },
      { label: "Two-factor authentication", free: true,  starter: true,  grow: true,  team: true,  enterprise: true },
    ],
  },
  {
    title: "Data and Compliance",
    rows: [
      { label: "Public API",                free: false, starter: false, grow: false, team: "Limited", enterprise: "Limited" },
      { label: "Scheduled reports",         free: false, starter: true,  grow: true,  team: true,      enterprise: true },
      { label: "Custom fields",             free: false, starter: true,  grow: true,  team: true,      enterprise: true },
      { label: "Historical bill/pay rates", free: false, starter: true,  grow: true,  team: true,      enterprise: true },
      { label: "Department/cost centers",   free: false, starter: true,  grow: true,  team: true,      enterprise: true },
    ],
  },
  {
    title: "Support",
    rows: [
      { label: "Help Center",              free: true,              starter: true,     grow: true,    team: true,    enterprise: true },
      { label: "Learning Center",          free: true,              starter: true,     grow: true,    team: true,    enterprise: true },
      { label: "Chat support",             free: false,             starter: false,    grow: false,   team: true,    enterprise: true },
      { label: "Email support SLA (24x5)", free: "Limited support", starter: "2 days", grow: "1 day", team: "1 day", enterprise: "2 hours" },
      { label: "Assigned account rep",     free: false,             starter: false,    grow: false,   team: false,   enterprise: true },
      { label: "Concierge setup",          free: false,             starter: false,    grow: false,   team: false,   enterprise: true },
      { label: "VIP Support \"Enhanced\"", free: false, starter: "$29/mo per org (subscriptions $275–$400)", grow: false, team: false, enterprise: true },
      { label: "VIP Support \"The works\"",free: false, starter: "$59/mo per org (subscriptions above $400)", grow: false, team: false, enterprise: true },
    ],
  },
]

const KEYS = ["free", "starter", "grow", "team", "enterprise"] as const

function CellValue({ val }: { val: V }) {
  if (val === true)  return <Check className="w-5 h-5 text-emerald-500 mx-auto" />
  if (val === false) return <X className="w-5 h-5 text-slate-200 mx-auto" />
  return <span className="text-xs font-medium text-slate-600">{val}</span>
}

function AddonTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-400 hover:text-slate-600 transition-colors" type="button"
      >
        <Info className="w-4 h-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-2 w-64 bg-blue-500 text-white text-sm font-semibold rounded-xl p-4 shadow-lg z-50 whitespace-pre-line"
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CycleToggle() {
  const { cycle, setCycle } = use(CycleContext)
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const yearlyBtnRef = useRef<HTMLButtonElement | null>(null)
  const [pillStyle, setPillStyle] = useState<{ width: number; x: number }>({ width: 0, x: 0 })

  useEffect(() => {
    const idx = CYCLE_OPTIONS.findIndex(o => o.k === cycle)
    const btn = btnRefs.current[idx]
    const container = containerRef.current
    if (btn && container) {
      const btnRect = btn.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      setPillStyle({ width: btnRect.width, x: btnRect.left - containerRect.left })
    }
  }, [cycle])

  const handleChange = (c: Cycle) => {
    if (c === cycle) return
    setCycle(c)
    if (c === "yearly" && yearlyBtnRef.current) {
      const rect = yearlyBtnRef.current.getBoundingClientRect()
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight },
        colors: ["#3b82f6", "#10b981", "#f59e0b"],
        disableForReducedMotion: true,
      })
    }
  }

  return (
    <div className="flex justify-center mb-8">
      <div ref={containerRef} className="relative inline-flex items-center bg-slate-100 rounded-full p-1">
        <motion.div
          className="absolute top-1 bottom-1 bg-white rounded-full shadow-sm"
          animate={{ x: pillStyle.x, width: pillStyle.width }}
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
        {CYCLE_OPTIONS.map((opt, i) => (
          <button
            key={opt.k}
            ref={el => {
              btnRefs.current[i] = el
              if (opt.k === "yearly") yearlyBtnRef.current = el
            }}
            onClick={() => handleChange(opt.k)}
            className={cn(
              "relative z-10 flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
              cycle === opt.k ? "text-slate-800" : "text-slate-500 hover:text-slate-700"
            )} type="button"
          >
            {opt.label}
            {opt.badge && (
              <span className={cn(
                "hidden sm:inline text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-colors",
                cycle === opt.k ? "bg-emerald-100 text-emerald-700" : "bg-emerald-100 text-emerald-600"
              )}>
                {opt.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlanCard({ plan, index }: { plan: (typeof PLANS)[number]; index: number }) {
  const { cycle } = use(CycleContext)
  const price = cycle === "monthly" ? plan.monthlyPrice : cycle === "quarterly" ? plan.quarterlyPrice : plan.yearlyPrice

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className={cn("relative bg-white rounded-2xl border-2 p-6 flex flex-col transition-all hover:shadow-lg", plan.borderColor)}
    >
      {plan.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-500 text-white text-xs font-bold rounded-full whitespace-nowrap">
          MOST POPULAR
        </div>
      )}

      <h3 className="text-xl font-semibold text-slate-800 mb-5">{plan.name}</h3>

      <div className="mb-5">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-slate-800">$<NumberFlow value={price} /></span>
          <span className="text-sm text-slate-500 ml-1">/ seat / mo</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">{plan.note}</p>
      </div>

      <button className="w-full py-2.5 rounded-xl font-semibold text-sm bg-blue-500 hover:bg-blue-600 text-white transition-colors mb-6" type="button">
        {plan.cta}
      </button>

      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold text-slate-700 mb-3">{plan.includesLabel}</p>

        {plan.addons.length > 0 && (
          <div className="bg-blue-50 rounded-xl p-3 mb-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Included Add-ons</p>
            <div className="space-y-2">
              {plan.addons.map(name => {
                const addon = ADDON_MAP[name]
                if (!addon) return null
                return (
                  <div key={name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {addon.smallIcon}
                      <span className="text-sm font-semibold text-slate-700">{name}</span>
                    </div>
                    <AddonTooltip text={addon.tooltip} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {plan.highlight.map((item, i) => (
          <div key={`${plan.name}-highlight-${i}`} className="flex items-start gap-2.5 py-0.5">
            <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
            <span className="text-sm text-slate-700">{item}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function FreePlanBanner() {
  const mid = Math.ceil(FREE_FEATURES.length / 2)
  return (
    <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-6">
      <div className="shrink-0">
        <h3 className="text-2xl font-light text-slate-800">Free</h3>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-4xl font-bold text-slate-800">$0</span>
          <span className="text-sm text-slate-500">For one seat only</span>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-1.5">
        {FREE_FEATURES.slice(0, mid).map((f, i) => <p key={`idx-${i}`} className="text-sm text-slate-600">{f}</p>)}
        {FREE_FEATURES.slice(mid).map((f, i) => <p key={`idx-${i}`} className="text-sm text-slate-600">{f}</p>)}
      </div>
      <button disabled className="shrink-0 px-8 py-3 rounded-xl font-semibold text-sm bg-blue-200 text-white cursor-not-allowed" type="button">
        Unavailable
      </button>
    </div>
  )
}
const planNames = ["Free", "Starter", "Grow", "Team", "Enterprise"]

function ComparisonTable() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="mx-auto flex items-center gap-2 py-3 px-6 rounded-full border border-blue-300 text-blue-500 font-semibold text-sm hover:bg-blue-50 transition-colors" type="button"
      >
        Show full plan comparison
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden mt-6"
          >
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[25%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left p-4 font-semibold text-slate-700">Feature</th>
                    {planNames.map(p => (
                      <th key={p} className="p-4 text-center font-semibold text-slate-700">
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(section => (
                    <>
                      <tr key={section.title}>
                        <td colSpan={6} className="pt-6 pb-2 px-4 bg-slate-50">
                          <h3 className="text-base font-bold text-slate-700">{section.title}</h3>
                        </td>
                      </tr>
                      {section.rows.map((row, i) => (
                        <tr key={row.label} className={cn("border-b border-slate-50 transition-colors hover:bg-slate-50", i % 2 === 0 ? "bg-white" : "bg-slate-50/50")}>
                          <td className="p-4 font-medium text-slate-700">
                            {row.label}
                            {row.note && <sup className="ml-0.5 text-slate-400">{row.note}</sup>}
                          </td>
                          {KEYS.map(k => (
                            <td key={k} className="p-4 text-center">
                              <CellValue val={row[k]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AddonsSection() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-1">Add-ons</h2>
        <p className="text-slate-500 text-sm">Enhance your plan with powerful add-ons</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {ADDONS.map((addon, i) => (
          <motion.div
            key={addon.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition-shadow flex flex-col"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-slate-100 rounded-lg shrink-0">{addon.icon}</div>
              <div>
                <h3 className="font-semibold text-slate-800">{addon.name}</h3>
                <p className="text-sm text-slate-500">${addon.pricePerSeat} per seat / month</p>
              </div>
            </div>
            <div className="space-y-2 flex-1">
              {addon.features.map((feature, i) => (
                <div key={`idx-${i}`} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-slate-600">{feature}</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-5 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors" type="button">
              Add to plan
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

export function SubscriptionPlans({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [cycle, setCycle] = useState<Cycle>("monthly")
  return (
    <CycleContext.Provider value={{ cycle, setCycle }}>
      <CycleToggle />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
        {PLANS.map((plan, i) => <PlanCard key={plan.name} plan={plan} index={i} />)}
      </div>
      <FreePlanBanner />
      <ComparisonTable />
      <div className="mt-12"><AddonsSection /></div>
      <p className="text-center text-sm text-slate-400 mt-8">
        All plans include a 14-day free trial. No credit card required to start.
      </p>
    </CycleContext.Provider>
  )
}

