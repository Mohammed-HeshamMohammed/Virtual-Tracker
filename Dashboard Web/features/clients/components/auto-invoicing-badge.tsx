"use client"

import type { Client } from "@/features/clients/models/client"

export function AutoInvoicingBadge({ invoicing }: { invoicing: Client["invoicing"] }) {
  if (!invoicing.autoInvoicing) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
        Off
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      {invoicing.autoFrequency.charAt(0).toUpperCase() + invoicing.autoFrequency.slice(1)}
    </span>
  )
}
