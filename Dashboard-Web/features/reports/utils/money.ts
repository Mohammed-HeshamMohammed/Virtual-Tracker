
export function formatMoney(amount: number, currency: string = "USD"): string {
  const rounded = amount.toFixed(2)
  return currency === "USD" ? `$${rounded}` : `${currency} ${rounded}`
}

export function parseMoneyLabel(label: string): { currency: string; amount: number } {
  const trimmed = String(label ?? "").trim()
  const amount = Number(trimmed.replace(/[^0-9.-]/g, "")) || 0
  const codeMatch = trimmed.match(/^([A-Za-z]{2,5})\s/)
  const currency = codeMatch ? codeMatch[1].toUpperCase() : "USD"
  return { currency, amount }
}

/** Drops a currency that summed to exactly zero and joins what's left.
 *  A member with no pay rate configured converts to "$0.00" (the hardcoded
 *  fallback in resolveCurrencyForDay/resolveRateForDay on the backend) even
 *  on a team paid entirely in another currency - so a real "EGP 787.54" read
 *  as "$0.00 + EGP 787.54", claiming a second currency that was never
 *  actually earned. A currency contributing nothing has nothing to report. */
function joinNonZero(byCurrency: Map<string, number>): string {
  const real = [...byCurrency.entries()].filter(([, amount]) => amount !== 0)
  if (real.length === 0) return formatMoney(0, "USD")
  return real
    .sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" + ")
}

export function sumMoneyStrings(amountList: string[]): string {
  const byCurrency = new Map<string, number>()
  for (const label of amountList) {
    for (const part of String(label ?? "").split("+")) {
      if (!part.trim()) continue
      const { currency, amount } = parseMoneyLabel(part)
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount)
    }
  }
  return joinNonZero(byCurrency)
}

export function sumMoneyByCurrency(rows: { amount: number; currency?: string }[]): string {
  const byCurrency = new Map<string, number>()
  for (const row of rows) {
    const currency = (row.currency || "USD").toUpperCase()
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + row.amount)
  }
  return joinNonZero(byCurrency)
}
