/** Pay-rate currency options. USD keeps the existing "$X/hr" display for
 * backward compatibility; anything else shows as "X CODE/hr". */
export const PAY_RATE_CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "EGP", label: "EGP" },
] as const

export type PayRateCurrency = (typeof PAY_RATE_CURRENCIES)[number]["value"]

export function formatPayRateDisplay(amount: number, currency: string = "USD"): string {
  if (!amount || amount <= 0) return "0/hr"
  if (currency === "USD") return `$${amount}/hr`
  return `${amount} ${currency}/hr`
}

/** Inverse of formatPayRateDisplay - parses "$50/hr" or "50 EGP/hr" back into parts. */
export function parsePayRateDisplay(payment: string | undefined): { amount: string; currency: string } {
  const value = (payment ?? "").trim()
  const usdMatch = value.match(/^\$([\d.]+)\/hr$/)
  if (usdMatch) return { amount: usdMatch[1], currency: "USD" }
  const otherMatch = value.match(/^([\d.]+)\s+([A-Za-z]+)\/hr$/)
  if (otherMatch) return { amount: otherMatch[1], currency: otherMatch[2].toUpperCase() }
  return { amount: "", currency: "USD" }
}
