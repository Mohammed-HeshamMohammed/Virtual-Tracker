"use client"

import { useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, X, Search, Lock, CreditCard, Building2, ChevronDown, Star } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Tip, ReferralModal } from "@/features/settings/components/billing/components/shared"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { ADD_ONS, BANKS, SAVED_CARDS, type AddOn } from "@/features/settings/components/shared/constants"


function PaymentDetailsModal({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useComponentState(SAVED_CARDS)
  const single = cards.length === 1
  const defaultCard = cards.find(c => c.default) ?? cards[0]

  const setDefault = (id: string) =>
    setCards(p => p.map(c => ({ ...c, default: c.id === id })))

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4"
        initial={{ scale: 0.96, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      >
        <div className="flex items-center gap-3 px-7 pt-7 pb-5 border-b border-slate-100">
          <CreditCard className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-bold text-slate-800">Payment Method Details</h2>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600" type="button"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-7 py-5 space-y-3">
          {single ? (
            <>
              {[
                { label: "Type",          value: defaultCard.type   },
                { label: "Brand",         value: defaultCard.brand  },
                { label: "Last 4 digits", value: defaultCard.last4  },
                { label: "Expires",       value: defaultCard.expiry },
              ].map(({ label, value }, i, arr) => (
                <div key={label} className={cn("flex items-center py-3", i < arr.length - 1 && "border-b border-slate-100")}>
                  <span className="w-40 text-sm font-bold text-slate-700">{label}</span>
                  <span className="text-sm text-slate-600">{value}</span>
                </div>
              ))}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 mb-3">Select a card to set as your default payment method.</p>
              {cards.map(card => (
                <div
                  key={card.id}
                  onClick={() => setDefault(card.id)}
                  className={cn(
                    "flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all cursor-pointer",
                    card.default ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <CreditCard className={cn("w-5 h-5 shrink-0", card.default ? "text-blue-500" : "text-slate-400")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{card.brand} •••• {card.last4}</p>
                    <p className="text-xs text-slate-400">Expires {card.expiry}</p>
                  </div>
                  {card.default
                    ? <span className="flex items-center gap-1 text-xs font-bold text-blue-500"><Star className="w-3.5 h-3.5 fill-blue-500" /> Default</span>
                    : <span className="text-xs text-slate-400 hover:text-blue-500 transition-colors">Set default</span>
                  }
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-7 pb-7 pt-2">
          <button onClick={onClose} className="px-6 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors font-medium" type="button">Close</button>
        </div>
      </motion.div>
    </motion.div>
  )
}


function BankLinkModal({ bank, onClose }: { bank: typeof BANKS[number]; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative z-[70] bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 flex flex-col items-center gap-4"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600" type="button"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-1 text-sm font-bold">
          <span className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">▶</span>
          <span>link</span>
        </div>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white" style={{ backgroundColor: bank.color }}>
          {bank.letter}
        </div>
        <h3 className="text-xl font-bold text-slate-900">Log in to {bank.name}</h3>
        <div className="w-full space-y-4 text-sm text-slate-600">
          <div className="flex gap-3">
            <span className="mt-0.5 text-slate-400">🔗</span>
            <div><p className="font-semibold text-slate-800">Fast and simple</p><p>Netsoft Holdings, LLC uses Link to connect your accounts.</p></div>
          </div>
          <div className="flex gap-3">
            <Lock className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
            <div><p className="font-semibold text-slate-800">Data is encrypted</p><p>Your data is protected, and you can <button className="underline text-blue-500" type="button">disconnect</button> at any time.</p></div>
          </div>
        </div>
        <p className="text-xs text-slate-400 text-center">By continuing, you agree to Link's <button className="underline text-blue-500" type="button">Terms and Privacy Policy</button>.</p>
        <button className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition-colors" type="button">Agree and continue</button>
      </motion.div>
    </motion.div>
  )
}


function PaymentModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useComponentState<"card" | "bank">("card")
  const [linkOpen, setLinkOpen] = useComponentState(false)
  const [bankSearch, setBankSearch] = useComponentState("")
  const [selectedBank, setSelectedBank] = useComponentState<typeof BANKS[number] | null>(null)
  const [form, setForm] = useComponentState({ name: "", country: "Germany", address: "", cardNumber: "", expiry: "", cvc: "", email: "", phone: "", linkName: "", linkEmail: "" })

  const filtered = BANKS.filter(b => b.name.toLowerCase().includes(bankSearch.toLowerCase()))

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative z-[70] bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 flex flex-col"
        style={{ maxHeight: "90vh" }}
        initial={{ scale: 0.96, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      >
        <div className="flex items-center justify-between px-8 pt-7 pb-5 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">New payment method</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" type="button"><X className="w-5 h-5" /></button>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 space-y-5"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" aria-label="Interactive control">Full name</label>
            <input className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Country or region</label>
            <div className="relative">
              <select className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}>
                {["Germany", "United States", "United Kingdom", "France", "Spain"].map(c => <option key={c}>{c}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" aria-label="Interactive control">Address</label>
            <input className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setTab("card")}
              className={cn(
                "flex items-center gap-2 border rounded-xl px-5 py-3.5 text-sm transition-colors",
                tab === "card" ? "border-slate-800 text-slate-800 font-bold" : "border-slate-200 text-slate-400 font-normal hover:border-slate-300"
              )} type="button"
            >
              <CreditCard className={cn("w-4 h-4", tab === "card" ? "text-slate-800" : "text-slate-400")} />
              Card
            </button>
            <button
              onClick={() => setTab("bank")}
              className={cn(
                "flex items-center justify-between border rounded-xl px-5 py-3.5 text-sm transition-colors",
                tab === "bank" ? "border-slate-800 text-slate-800 font-bold" : "border-slate-200 text-slate-400 font-normal hover:border-slate-300"
              )} type="button"
            >
              <span className="flex items-center gap-2">
                <Building2 className={cn("w-4 h-4", tab === "bank" ? "text-slate-800" : "text-slate-400")} />
                Bank
              </span>
              {tab !== "bank" && <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded font-bold">$5 back</span>}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {tab === "card" && (
              <motion.div key="card" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setLinkOpen(p => !p)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50 transition-colors" type="button"
                  >
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <Lock className="w-4 h-4 text-green-500" />
                      Secure, fast checkout with Link
                    </span>
                    <X className={cn("w-4 h-4 text-slate-400 transition-transform", linkOpen ? "rotate-0" : "rotate-45")} />
                  </button>
                  <AnimatePresence>
                    {linkOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-slate-100"
                      >
                        <div className="px-4 py-4 space-y-4 bg-white">
                          <p className="text-sm text-slate-500">Securely pay with your saved info, or create a Link account for faster checkout next time.</p>
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1.5">Email</label>
                            <input placeholder="you@example.com" className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.linkEmail} onChange={e => setForm(p => ({ ...p, linkEmail: e.target.value }))} />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 border-t border-slate-100 pt-3">
                            <span className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white text-[9px]">▶</span>
                            <span>link</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5" aria-label="Interactive control">Card number</label>
                  <div className="relative">
                    <input placeholder="1234 1234 1234 1234" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 pr-36" value={form.cardNumber} onChange={e => setForm(p => ({ ...p, cardNumber: e.target.value }))} />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-1">
                      {["MC","VISA","AMEX","DISC"].map(b => <span key={b} className="text-[9px] border border-slate-200 rounded px-1 py-0.5 text-slate-400 font-bold">{b}</span>)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Expiration date</label>
                    <input placeholder="MM / YY" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.expiry} onChange={e => setForm(p => ({ ...p, expiry: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5" aria-label="Interactive control">Security code</label>
                    <div className="relative">
                      <input placeholder="CVC" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 pr-12" value={form.cvc} onChange={e => setForm(p => ({ ...p, cvc: e.target.value }))} />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-mono">123</span>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400">By providing your card information, you allow Netsoft Holdings, LLC to charge your card for future payments in accordance with their terms.</p>

                <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div><p className="text-xs text-slate-400">Optional</p><p className="text-sm font-semibold text-slate-700">Save my information for faster checkout</p></div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Email</label>
                    <input placeholder="you@example.com" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Mobile number</label>
                    <div className="flex">
                      <span className="border border-r-0 border-slate-200 rounded-l-xl px-4 py-3 text-sm bg-slate-50 flex items-center gap-1" aria-label="Interactive control">🇩🇪 <ChevronDown className="w-3 h-3 text-slate-400" /></span>
                      <input placeholder="01512 3456789" className="flex-1 border border-slate-200 rounded-r-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} aria-label="Interactive control" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Full name</label>
                    <input placeholder="First and last name" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={form.linkName} onChange={e => setForm(p => ({ ...p, linkName: e.target.value }))} />
                  </div>
                  <p className="text-xs text-slate-400"><span className="text-green-500 font-bold">▶ link</span> · By providing phone number and email, you agree to create an account subject to <button className="underline text-blue-500" type="button">Terms</button> and <button className="underline text-blue-500" type="button">Privacy Policy</button>.</p>
                </div>

                <div className="flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3 h-3" /> Safe and secure.</div>
              </motion.div>
            )}

            {tab === "bank" && (
              <motion.div key="bank" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
                <div className="bg-green-500 text-white text-sm rounded-xl px-5 py-3 flex items-center gap-2">
                  🏷️ <span>Get $5 when you pay for the first time with your bank. <button className="underline font-semibold" type="button" aria-label="Interactive control">See terms</button></span>
                </div>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input placeholder="Search for your bank" className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={bankSearch} onChange={e => setBankSearch(e.target.value)} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {filtered.map(bank => (
                    <button key={bank.name} onClick={() => setSelectedBank(bank)} className="flex flex-col items-center gap-2 p-3 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-all" type="button">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-base" style={{ backgroundColor: bank.color }}>{bank.letter}</div>
                      <span className="text-[11px] text-slate-600 text-center leading-tight">{bank.name}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3 h-3" /> Safe and secure.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex justify-end gap-3 px-8 py-5 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors" type="button">Cancel</button>
          <button className="px-6 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-colors" type="button">Save</button>
        </div>

        <AnimatePresence>{selectedBank && <BankLinkModal bank={selectedBank} onClose={() => setSelectedBank(null)} />}</AnimatePresence>
      </motion.div>
    </motion.div>
  )
}


function AddonCard({ addon, onToggle }: { addon: AddOn; onToggle: () => void }) {
  const cols = addon.featuresColumns === 2 ? "grid-cols-2" : "grid-cols-1"

  const ctaButton = (
    <Button
      size="sm"
      variant={addon.ctaOutline || (addon.active && !addon.free) ? "outline" : "default"}
      className={cn(!addon.ctaOutline && !addon.active ? "bg-blue-500 hover:bg-blue-600 text-white" : "")}
      onClick={onToggle}
    >
      {addon.active && !addon.free ? "Remove add-on" : addon.cta}
    </Button>
  )

  const priceBlock = (
    <div>
      {addon.price
        ? <>
            <span className="font-mono text-4xl font-semibold tracking-tight text-slate-800">{addon.price}</span>
            <span className="text-slate-400 text-xs ml-1">{addon.per}</span>
          </>
        : <span className="font-mono text-2xl font-semibold tracking-tight text-purple-500">Free</span>
      }
      {addon.extra && <button className="mt-2 text-xs text-blue-500 hover:underline block" type="button">{addon.extra}</button>}
    </div>
  )

  const featuresList = (
    <ul className={cn("grid gap-2", cols)}>
      {addon.features.map(f => (
        <li key={f} className="flex items-start gap-2 text-xs text-slate-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" /> {f}
        </li>
      ))}
    </ul>
  )

  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border-2 transition-all",
      addon.active && !addon.free ? "border-blue-400 shadow-sm" : "border-slate-300",
      addon.colSpan
    )}>

      <div className="flex flex-wrap items-center gap-3 p-4">
        <Badge
          variant={addon.active ? "default" : "secondary"}
          className={cn(
            addon.active && !addon.free ? "bg-blue-500 text-white" : "",
            addon.free ? "bg-purple-500 text-white" : ""
          )}
        >
          {addon.badge}
        </Badge>

        {addon.free && (
          <Badge variant="outline" className="text-purple-500 border-purple-200">FREE</Badge>
        )}

        {addon.active && (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Active
          </span>
        )}

        {addon.priceInHeader && (
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xl font-semibold tracking-tight text-slate-800">{addon.price}</span>
            <span className="text-slate-400 text-xs">{addon.per}</span>
          </div>
        )}

        <div className="ml-auto">{ctaButton}</div>
      </div>

      <div className="px-4 pb-4">
        {addon.priceInHeader ? (
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">{addon.headline}</p>
            {featuresList}
          </div>
        ) : addon.headlineUnderPrice ? (
          <div className="space-y-3">
            {priceBlock}
            <p className="text-xs font-bold text-slate-600">{addon.headline}</p>
            {featuresList}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="lg:w-[35%]">{priceBlock}</div>
            <div className="lg:w-[65%]">
              <p className="text-xs font-bold text-slate-600 mb-2">{addon.headline}</p>
              {featuresList}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


export function BillingInformation({
  onNavigateToInvoices,
  onChangePlan,
}: {
  onNavigateToInvoices: () => void
  onChangePlan: () => void
}) {
  const [showReferral, setShowReferral] = useComponentState(false)
  const [showPaymentModal, setShowPaymentModal] = useComponentState(false)
  const [showDetailsModal, setShowDetailsModal] = useComponentState(false)
  const [addOns, setAddOns] = useComponentState<AddOn[]>(ADD_ONS as unknown as AddOn[])

  const toggleAddon = (name: string) =>
    setAddOns(p => p.map(a => a.name === name ? { ...a, active: !a.active } : a))

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <h2 className="text-base font-bold text-slate-800">Your plan</h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-white">Active</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors" type="button">Team — Monthly</button>
              <button onClick={onChangePlan} className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors" type="button">Change plan</button>
            </div>
            <div className="text-sm text-slate-500 flex items-center gap-1.5">
              <Tip text="Number of paid, occupied, and open seats in your plan" />
              Seats: 9 paid | 4 occupied | 5 open
            </div>
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 mb-1">Referral discounts</h2>
            <p className="text-sm text-slate-500">
              <button onClick={() => setShowReferral(true)} className="text-blue-500 hover:underline" type="button">Invite some friends</button>
              {" "}and get Hubstaff free.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <h2 className="text-base font-bold text-slate-800">Payment method</h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-white">Active</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowDetailsModal(true)} className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors" type="button">View payment details</button>
              <button onClick={() => setShowPaymentModal(true)} className="px-4 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors" type="button">Change payment method</button>
              <button className="px-4 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors" type="button">Remove payment method</button>
            </div>
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 mb-2">Billing history</h2>
            <div className="group relative inline-block">
              <button onClick={onNavigateToInvoices} className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors" type="button">View billing history</button>
              <div className="absolute top-full left-0 mt-1 bg-slate-700 text-white text-xs rounded-lg px-3 py-2 w-52 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[60]">View past charges, proration history and print past invoices</div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-base font-bold text-slate-800 mb-4">Compare plans</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-8">
          {addOns.map(addon => (
            <AddonCard key={addon.name} addon={addon} onToggle={() => toggleAddon(addon.name)} />
          ))}
        </div>
      </div>

      <AnimatePresence>{showReferral     && <ReferralModal       onClose={() => setShowReferral(false)} />}</AnimatePresence>
      <AnimatePresence>{showPaymentModal && <PaymentModal        onClose={() => setShowPaymentModal(false)} />}</AnimatePresence>
      <AnimatePresence>{showDetailsModal && <PaymentDetailsModal onClose={() => setShowDetailsModal(false)} />}</AnimatePresence>
    </div>
  )
}

