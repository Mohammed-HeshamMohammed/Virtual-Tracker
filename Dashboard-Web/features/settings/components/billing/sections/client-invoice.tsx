"use client"

import { cn } from "@/shared/utils/utils"
import { useClientInvoice } from "@/features/settings/hooks/use-client-invoice"
import { SimpleDropdown, Toggle, Tip, inputCls, labelCls } from "@/features/settings/components/billing/components/shared"
import { LINE_ITEMS_OPTIONS, FREQUENCY_OPTIONS } from "@/features/settings/components/shared/constants"

export function ClientInvoice() {
  const {
    address, setAddress,
    taxId, setTaxId,
    logoFile, setLogoFile,
    taxRate, setTaxRate,
    notes, setNotes,
    netTerms, setNetTerms,
    paypalEmail, setPaypalEmail,
    autoInvoicing, setAutoInvoicing,
    amountBased, setAmountBased,
    fixedPrice, setFixedPrice,
    frequency, setFrequency,
    delaySending, setDelaySending,
    sendReminder, setSendReminder,
    lineItems, setLineItems,
    includeNonBillable, setIncludeNonBillable,
    includeExpenses, setIncludeExpenses,
    logoRef,
  } = useClientInvoice(LINE_ITEMS_OPTIONS[0])

  const numInput = (value: string, onChange: (v: string) => void, suffix: string) => (
    <div className="flex items-center">
      <input
        value={value} onChange={e => onChange(e.target.value)} type="number"
        className="w-32 px-3 py-2.5 border border-slate-200 border-r-0 rounded-l-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors" aria-label="Interactive control"
      />
      <span className="px-3 py-2.5 border border-slate-200 rounded-r-lg text-sm text-slate-500 bg-slate-50">{suffix}</span>
    </div>
  )

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

        <div className="space-y-7">
          <section>
            <h2 className="text-base font-bold text-slate-800 mb-0.5">General</h2>
            <p className="text-xs text-slate-500 mb-3">Changes made here will also update your organization's General settings</p>
            <label className={labelCls} aria-label="Interactive control">Address</label>
            <textarea value={address} onChange={e => setAddress(e.target.value)} rows={4} className={cn(inputCls, "resize-y")} />
          </section>

          <div>
            <label className={cn(labelCls, "flex items-center gap-1")}>
              Tax ID <Tip text="Your organization's tax identification number" aria-label="Interactive control" />
            </label>
            <input value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="Enter tax ID" className={inputCls} />
          </div>

          <section>
            <h2 className="text-base font-bold text-slate-800 mb-0.5">Invoice logo</h2>
            <p className="text-xs text-slate-500 mb-3">This is a logo used specifically for invoices, and will apply to all invoices made</p>
            <label className={labelCls}>Logo</label>
            <div className="flex items-center gap-2">
              <button onClick={() => logoRef.current?.click()} className="px-3 py-1.5 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50" type="button">
                Choose file
              </button>
              <span className="text-sm text-slate-400">{logoFile || "No file chosen"}</span>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0]?.name || "")} />
            </div>
            <p className="text-xs text-slate-400 mt-1">File size limit: 1 MB</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-slate-800 mb-3">Payment</h2>
            <label className={cn(labelCls, "flex items-center gap-1")}>
              Tax Rate <Tip text="Applied to all client invoices" />
            </label>
            {numInput(taxRate, setTaxRate, "%")}
          </section>

          <div>
            <label className={cn(labelCls, "flex items-center gap-1")}>
              Notes (shown on invoices) <Tip text="These notes will appear on all client invoices" aria-label="Interactive control" />
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Enter notes to client" className={cn(inputCls, "resize-y")} />
          </div>

          <div>
            <label className={cn(labelCls, "flex items-center gap-1")}>
              Net Terms* <Tip text="Number of days the client has to pay the invoice" />
            </label>
            {numInput(netTerms, setNetTerms, "days")}
          </div>

          <section>
            <h2 className="text-base font-bold text-slate-800 mb-3" aria-label="Interactive control">Payment button</h2>
            <label className={labelCls}>PayPal Email</label>
            <input value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} placeholder="Enter your business's PayPal email address" className={inputCls} />
            <p className="text-xs text-slate-400 mt-1">Easily accept payments from clients with PayPal</p>
          </section>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button className="px-5 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors" type="button">Cancel</button>
            <button className="px-6 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors" type="button">Save</button>
          </div>
        </div>

        <div className="space-y-5">
          <h2 className="text-base font-bold text-slate-800">Auto invoicing</h2>

          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
            {(["Off", "On"] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setAutoInvoicing(opt === "On")}
                className={cn(
                  "px-6 py-1.5 text-sm font-medium rounded-full transition-colors",
                  (autoInvoicing ? opt === "On" : opt === "Off") ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )} type="button"
              >
                {opt}
              </button>
            ))}
          </div>

          <p className={cn("text-sm", autoInvoicing ? "text-slate-500" : "text-slate-300")}>
            These settings will be applied to all clients unless explicitly disabled or custom settings are applied.
          </p>

          <div className={cn("space-y-5 transition-opacity", !autoInvoicing && "opacity-40 pointer-events-none")}>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Amount Based On</label>
                <div className="space-y-2">
                  {(["Hourly", "Fixed price"] as const).map(opt => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={amountBased === opt} onChange={() => setAmountBased(opt)} className="accent-blue-500" />
                      <span className="text-sm text-slate-700">{opt}</span>
                      {opt === "Fixed price" && (
                        <div className="flex items-center ml-2">
                          <input
                            value={fixedPrice} onChange={e => setFixedPrice(e.target.value)} type="number"
                            className="w-16 px-2 py-1 border border-slate-200 border-r-0 rounded-l text-sm focus:outline-none focus:border-blue-400"
                          />
                          <span className="px-2 py-1 border border-slate-200 rounded-r text-sm text-slate-500 bg-slate-50">USD</span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Frequency</label>
                <SimpleDropdown value={frequency} options={FREQUENCY_OPTIONS} onChange={setFrequency} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className={cn(labelCls, "flex items-center gap-1")}>
                  Delay Sending <Tip text="Days to wait before sending the invoice" />
                </label>
                <div className="flex items-center">
                  <input
                    value={delaySending} onChange={e => setDelaySending(e.target.value)} type="number"
                    className="w-14 px-2 py-2 border border-slate-200 border-r-0 rounded-l-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                  <span className="px-3 py-2 border border-slate-200 rounded-r-lg text-sm text-slate-500 bg-slate-50">days</span>
                </div>
              </div>

              <div>
                <label className={cn(labelCls, "flex items-center gap-1")}>
                  Send Reminder to Pay After Due
                  <Tip text="Days after due date to send payment reminder" preferLeft aria-label="Interactive control" />
                </label>
                <div className="flex items-center">
                  <input
                    value={sendReminder} onChange={e => setSendReminder(e.target.value)} type="number"
                    className="w-14 px-2 py-2 border border-slate-200 border-r-0 rounded-l-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                  <span className="px-3 py-2 border border-slate-200 rounded-r-lg text-sm text-slate-500 bg-slate-50">days</span>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Line Items</label>
              <SimpleDropdown value={lineItems} options={LINE_ITEMS_OPTIONS} onChange={setLineItems} />
            </div>

            <div className="space-y-2">
              {[
                { label: "Include non-billable time", val: includeNonBillable, set: setIncludeNonBillable },
                { label: "Include expenses",          val: includeExpenses,    set: setIncludeExpenses },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={val} onChange={() => set(!val)} disabled={!autoInvoicing} />
                  <span className="text-sm text-slate-600">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

