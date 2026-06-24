  "use client"

  import { useState as useComponentState } from "react"
  import { cn } from "@/shared/utils/utils"
  import { SimpleDropdown, inputCls } from "@/features/settings/components/billing/components/shared"
  import { COUNTRIES, TAX_IDS } from "@/features/settings/components/shared/constants"

  export function SubscriptionSettings() {
    const [country, setCountry]       = useComponentState("Egypt")
    const [address1, setAddress1]     = useComponentState("4 Abbas Al akkad st")
    const [address2, setAddress2]     = useComponentState("")
    const [city, setCity]             = useComponentState("Tanta")
    const [state, setState]           = useComponentState("Gharbia Governorate")
    const [zip, setZip]               = useComponentState("31515")
    const [phone, setPhone]           = useComponentState("")
    const [taxId, setTaxId]           = useComponentState("")
    const [taxIdNum, setTaxIdNum]     = useComponentState("")
    const [notes, setNotes]           = useComponentState("")
    const [emailMode, setEmailMode]   = useComponentState<"Off" | "All owners" | "Custom">("Off")
    const [customEmails, setCustomEmails] = useComponentState("")

    return (
      <div className="space-y-6">

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-800 mb-0.5">Customize invoice</h2>
              <p className="text-sm text-slate-500 mb-4">Customize the invoice sent from Hubstaff to your organization</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bill to Address</p>
              <div className="space-y-2">
                <SimpleDropdown value={country} options={COUNTRIES} onChange={setCountry} searchable />
                <input value={address1} onChange={e => setAddress1(e.target.value)} className={inputCls} aria-label="Interactive control" />
                <input value={address2} onChange={e => setAddress2(e.target.value)} placeholder="Address line 2" className={inputCls} aria-label="Interactive control" />
                <input value={city}     onChange={e => setCity(e.target.value)}     className={inputCls} aria-label="Interactive control" />
                <input value={state}    onChange={e => setState(e.target.value)}    className={inputCls} aria-label="Interactive control" />
                <input value={zip}      onChange={e => setZip(e.target.value)}      className={inputCls} />
              </div>
            </div>

            <div aria-label="Interactive control">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Phone Number</p>
              <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} />
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tax ID</p>
              <div className="flex gap-2">
                <div className="min-w-40" aria-label="Interactive control">
                  <SimpleDropdown value={taxId} options={TAX_IDS} onChange={setTaxId} placeholder="Select" searchable />
                </div>
                <input value={taxIdNum} onChange={e => setTaxIdNum(e.target.value)} placeholder="Your Tax ID" className={cn(inputCls, "flex-1")} aria-label="Interactive control" />
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Notes</p>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                placeholder="Add any other info you would like to see on your invoice"
                className={cn(inputCls, "resize-y")}
              />
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-800 mb-0.5">Email notification settings</h2>
              <p className="text-sm text-slate-500 mb-3">Choose to receive subscription invoices from Hubstaff</p>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
                {(["Off", "All owners", "Custom"] as const).map(opt => (
                  <button
                    key={opt} onClick={() => setEmailMode(opt)}
                    className={cn(
                      "px-4 py-1.5 text-sm font-medium rounded-full transition-colors",
                      emailMode === opt ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )} type="button"
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {emailMode === "Custom" && (
                <div className="mt-3 space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Send Email To</p>
                  <textarea
                    value={customEmails} onChange={e => setCustomEmails(e.target.value)} rows={4}
                    placeholder="Add contact emails" className={cn(inputCls, "resize-y")}
                  />
                  <p className="text-xs text-slate-400">Add up to 5 email addresses, separated by new lines</p>
                </div>
              )}
            </div>

            <button className="px-6 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors" type="button">Save</button>
          </div>

          <div className="relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 border border-blue-200 bg-white rounded-full text-xs text-blue-500 z-10">Example</div>
            <div className="border border-slate-200 rounded-xl p-7 shadow-sm text-sm">
              <div className="flex items-center justify-between mb-6">
                <p className="font-bold text-slate-800 text-base">Invoice preview</p>
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">H</div>
                  <span className="font-bold text-slate-700">Hubstaff</span>
                </div>
              </div>
              <div className="space-y-0.5 mb-5 text-slate-600">
                <p><span className="font-semibold text-slate-800">Invoice number</span>  A1B2C3D4-0001</p>
                <p><span className="font-semibold text-slate-800">Date of issue</span>     Dec 31, 2026</p>
                <p><span className="font-semibold text-slate-800">Date due</span>          Dec 31, 2026</p>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="text-slate-600 text-xs space-y-0.5">
                  <p className="font-bold text-slate-800">Netsoft Holdings, LLC</p>
                  <p>11650 Olio Rd. Suite #1000 - 193</p>
                  <p>Fishers, Indiana 46037</p>
                  <p>United States</p>
                  <p>+1 800-932-5330</p>
                  <p>support@hubstaff.com</p>
                </div>
                <div className="text-xs space-y-0.5 text-slate-600">
                  <p className="font-semibold text-slate-800">Bill to</p>
                  <p>TVC (ID: 655406)</p>
                  <p>{address1}</p>
                  <p>{city}, {state} {zip}</p>
                  <p>{country}</p>
                  <p>info@thevirtualcallers.com</p>
                </div>
              </div>
              <p className="font-bold text-slate-800 text-lg mb-5">$30.00 due Dec 31, 2026</p>
              <div className="border-t border-slate-200 pt-4">
                <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-slate-700 mb-2">
                  <span className="col-span-2">Description</span><span>Quantity</span><span>Unit price</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs text-slate-600 pb-4 border-b border-slate-100">
                  <div className="col-span-2">
                    <p>Starter — Monthly</p>
                    <p className="text-slate-400">Nov 30, 2026 - Dec 31, 2026</p>
                  </div>
                  <span>3</span><span>$10.00</span>
                </div>
                <div className="space-y-1 pt-3 text-xs text-slate-600">
                  <div className="flex justify-between"><span>Subtotal</span><span>$30.00</span></div>
                  <div className="flex justify-between"><span>Total</span><span>$30.00</span></div>
                  <div className="flex justify-between font-bold text-slate-800 pt-1"><span>Amount due</span><span>$30.00</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
