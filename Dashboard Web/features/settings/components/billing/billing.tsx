/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { BillingInformation } from "@/features/settings/components/billing/sections/information"
import { SubscriptionInvoices } from "@/features/settings/components/billing/sections/invoices"
import { SubscriptionSettings } from "@/features/settings/components/billing/sections/settings"
import { ClientInvoice } from "@/features/settings/components/billing/sections/client-invoice"
import { BILLING_TABS } from "@/features/settings/components/shared/constants"
import type { BillingTab } from "@/features/settings/components/shared/constants"

const TABS = BILLING_TABS

export function BillingPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [tab, setTab] = useState<BillingTab>("info")

  return (
    <div className="flex flex-col h-full w-full">
      {/* Sticky tab bar */}
      <div className="shrink-0 border-b border-slate-200 flex gap-0 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={cn(
              "px-5 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 whitespace-nowrap transition-colors shrink-0",
              tab === t.k ? "text-blue-500 border-blue-500" : "text-slate-400 border-transparent hover:text-slate-600"
            )} type="button"
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] relative">
        <div className="p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              {tab === "info" && (
                <BillingInformation
                  onNavigateToInvoices={() => setTab("invoices")}
                  onChangePlan={() => onNavigate("settings-billing-plans")}
                />
              )}
              {tab === "invoices"      && <SubscriptionInvoices />}
              {tab === "settings"      && <SubscriptionSettings />}
              {tab === "clientinvoice" && <ClientInvoice />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

